"""Thread que lê a câmera/vídeo continuamente e mantém o estado mais recente."""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path

import cv2

from . import config as cfgmod
from .detector import DetectorVagas, desenhar
from .eventos import RepositorioEventos

log = logging.getLogger(__name__)


class Monitor:
    def __init__(self, caminho_config: Path, raiz: Path, repo: RepositorioEventos):
        self.caminho_config = caminho_config
        self.raiz = raiz
        self.repo = repo
        self._lock = threading.Lock()
        self._recarregar = threading.Event()
        self._rodando = False
        self._thread: threading.Thread | None = None
        self._jpeg_anotado: bytes | None = None
        self._jpeg_bruto: bytes | None = None
        self._estados: list[dict] = []
        self._erro: str | None = None
        self._atualizado_em: float = 0.0

    # ---------- API pública (thread-safe) ----------
    def iniciar(self) -> None:
        if self._rodando:
            return
        self._rodando = True
        self._thread = threading.Thread(target=self._loop, name="monitor", daemon=True)
        self._thread.start()

    def parar(self) -> None:
        self._rodando = False
        self._recarregar.set()

    def recarregar(self) -> None:
        """Pede para reler a configuração (ex.: após editar vagas)."""
        self._recarregar.set()

    def status(self) -> dict:
        with self._lock:
            vagas = list(self._estados)
            erro = self._erro
            atualizado = self._atualizado_em
        livres = sum(1 for v in vagas if v["ocupada"] is False)
        ocupadas = sum(1 for v in vagas if v["ocupada"] is True)
        return {
            "total": len(vagas),
            "livres": livres,
            "ocupadas": ocupadas,
            "vagas": vagas,
            "erro": erro,
            "online": erro is None and (time.time() - atualizado) < 5,
        }

    def jpeg(self, anotado: bool = True) -> bytes | None:
        with self._lock:
            return self._jpeg_anotado if anotado else self._jpeg_bruto

    # ---------- Laço interno ----------
    def _resolver_fonte(self, fonte: str) -> tuple[int | str, bool]:
        if fonte.isdigit():
            return int(fonte), False  # webcam
        caminho = Path(fonte)
        if not caminho.is_absolute():
            caminho = self.raiz / caminho
        if caminho.is_file():
            return str(caminho), True  # arquivo de vídeo (repete em loop)
        return fonte, False  # URL (RTSP/HTTP)

    def _definir_erro(self, msg: str | None) -> None:
        with self._lock:
            self._erro = msg

    def _loop(self) -> None:
        while self._rodando:
            self._recarregar.clear()
            try:
                cfg = cfgmod.carregar(self.caminho_config)
            except Exception as exc:  # config inválida: espera correção
                self._definir_erro(f"Configuração inválida: {exc}")
                self._recarregar.wait(2)
                continue

            fonte, eh_arquivo = self._resolver_fonte(cfg["fonte"])
            cap = cv2.VideoCapture(fonte)
            if not cap.isOpened():
                self._definir_erro(f"Não foi possível abrir a fonte de vídeo: {cfg['fonte']}")
                cap.release()
                self._recarregar.wait(3)
                continue

            detector = DetectorVagas(cfg["vagas"], cfg["limiar"], cfg["frames_confirmacao"])
            fps = cap.get(cv2.CAP_PROP_FPS)
            intervalo = 1 / fps if 1 <= fps <= 60 else 1 / 15
            self._definir_erro(None)
            log.info("Monitorando %s com %d vagas", cfg["fonte"], len(cfg["vagas"]))

            while self._rodando and not self._recarregar.is_set():
                inicio = time.monotonic()
                ok, frame = cap.read()
                if not ok:
                    if eh_arquivo:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        continue
                    self._definir_erro("Sinal de vídeo perdido; reconectando...")
                    break

                estados, eventos = detector.processar(frame)
                for ev in eventos:
                    self.repo.registrar(ev)

                ok1, bruto = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                ok2, anotado = cv2.imencode(".jpg", desenhar(frame, estados), [cv2.IMWRITE_JPEG_QUALITY, 80])
                with self._lock:
                    if ok1:
                        self._jpeg_bruto = bruto.tobytes()
                    if ok2:
                        self._jpeg_anotado = anotado.tobytes()
                    self._estados = [e.para_dict() for e in estados]
                    self._atualizado_em = time.time()
                    self._erro = None

                if eh_arquivo:  # respeita o FPS do vídeo (câmeras ao vivo já têm seu ritmo)
                    time.sleep(max(0.0, intervalo - (time.monotonic() - inicio)))

            cap.release()
            if self._rodando and not self._recarregar.is_set():
                time.sleep(2)  # antes de tentar reconectar
