"""Detecção de vagas livres/ocupadas a partir de um frame de câmera.

Abordagem (clássica, sem IA, ideal para MVP):
  1. Converte o frame para tons de cinza e aplica limiarização adaptativa,
     que realça bordas e texturas (carros têm muitas; asfalto vazio, poucas).
  2. Para cada vaga (polígono), conta a fração de pixels "ativos" dentro dela.
  3. Se a fração passa do limiar, a vaga é considerada ocupada.
  4. Um estado só muda depois de N frames consecutivos concordarem
     (evita "piscar" por sombras, pessoas passando, ruído etc.).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import cv2
import numpy as np


@dataclass
class EstadoVaga:
    id: str
    pontos: list[list[int]]
    ocupada: bool | None = None  # None = ainda não determinado
    ocupacao: float = 0.0  # fração de pixels ativos (0..1)
    desde: str | None = None  # ISO timestamp da última mudança
    _candidato: bool | None = field(default=None, repr=False)
    _contador: int = field(default=0, repr=False)

    def para_dict(self) -> dict:
        return {
            "id": self.id,
            "pontos": self.pontos,
            "ocupada": self.ocupada,
            "ocupacao": round(self.ocupacao, 4),
            "desde": self.desde,
        }


def preprocessar(frame: np.ndarray) -> np.ndarray:
    """Retorna imagem binária (0/255) com bordas/texturas realçadas."""
    cinza = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    borrada = cv2.GaussianBlur(cinza, (3, 3), 1)
    binaria = cv2.adaptiveThreshold(
        borrada, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 12
    )
    binaria = cv2.medianBlur(binaria, 5)  # remove ruído "sal e pimenta" do asfalto
    binaria = cv2.dilate(binaria, np.ones((3, 3), np.uint8), iterations=1)
    return binaria


class DetectorVagas:
    def __init__(self, vagas: list[dict], limiar: float = 0.10, frames_confirmacao: int = 5):
        self.limiar = limiar
        self.frames_confirmacao = max(1, int(frames_confirmacao))
        self.estados = [EstadoVaga(id=v["id"], pontos=v["pontos"]) for v in vagas]
        self._mascaras: list[tuple[np.ndarray, tuple[int, int, int, int], int]] | None = None
        self._formato: tuple[int, int] | None = None

    def _preparar_mascaras(self, altura: int, largura: int) -> None:
        """Pré-calcula, para cada vaga, a máscara recortada no seu retângulo envolvente."""
        self._mascaras = []
        for estado in self.estados:
            pts = np.array(estado.pontos, dtype=np.int32)
            pts[:, 0] = np.clip(pts[:, 0], 0, largura - 1)
            pts[:, 1] = np.clip(pts[:, 1], 0, altura - 1)
            x, y, w, h = cv2.boundingRect(pts)
            mascara = np.zeros((h, w), dtype=np.uint8)
            cv2.fillPoly(mascara, [pts - [x, y]], 255)
            area = max(1, cv2.countNonZero(mascara))
            self._mascaras.append((mascara, (x, y, w, h), area))
        self._formato = (altura, largura)

    def processar(self, frame: np.ndarray) -> tuple[list[EstadoVaga], list[dict]]:
        """Analisa um frame. Retorna (estados de todas as vagas, eventos de mudança)."""
        altura, largura = frame.shape[:2]
        if self._formato != (altura, largura):
            self._preparar_mascaras(altura, largura)

        binaria = preprocessar(frame)
        agora = datetime.now().isoformat(timespec="seconds")
        eventos: list[dict] = []

        for estado, (mascara, (x, y, w, h), area) in zip(self.estados, self._mascaras):
            recorte = binaria[y : y + h, x : x + w]
            ativos = cv2.countNonZero(cv2.bitwise_and(recorte, recorte, mask=mascara))
            estado.ocupacao = ativos / area
            leitura = estado.ocupacao >= self.limiar

            if estado.ocupada is None:  # primeiro frame: assume a leitura direto
                estado.ocupada = leitura
                estado.desde = agora
                continue

            if leitura == estado.ocupada:
                estado._candidato, estado._contador = None, 0
                continue

            if estado._candidato == leitura:
                estado._contador += 1
            else:
                estado._candidato, estado._contador = leitura, 1

            if estado._contador >= self.frames_confirmacao:
                estado.ocupada = leitura
                estado.desde = agora
                estado._candidato, estado._contador = None, 0
                eventos.append({"vaga": estado.id, "ocupada": leitura, "momento": agora})

        return self.estados, eventos


VERDE = (60, 200, 60)
VERMELHO = (50, 50, 230)
CINZA = (160, 160, 160)


def desenhar(frame: np.ndarray, estados: list[EstadoVaga]) -> np.ndarray:
    """Desenha os polígonos das vagas (verde = livre, vermelho = ocupada) e um placar."""
    saida = frame.copy()
    camada = frame.copy()
    for e in estados:
        cor = CINZA if e.ocupada is None else (VERMELHO if e.ocupada else VERDE)
        pts = np.array(e.pontos, dtype=np.int32)
        cv2.fillPoly(camada, [pts], cor)
        cv2.polylines(saida, [pts], True, cor, 2)
    saida = cv2.addWeighted(camada, 0.25, saida, 0.75, 0)

    for e in estados:
        pts = np.array(e.pontos, dtype=np.int32)
        cx, cy = pts.mean(axis=0).astype(int)
        texto = f"{e.id}"
        (tw, th), _ = cv2.getTextSize(texto, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        cv2.putText(saida, texto, (cx - tw // 2, cy + th // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

    livres = sum(1 for e in estados if e.ocupada is False)
    placar = f"Livres: {livres} / {len(estados)}"
    cv2.rectangle(saida, (0, 0), (260, 40), (0, 0, 0), -1)
    cv2.putText(saida, placar, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    return saida
