"""Gera um vídeo sintético de estacionamento + configuração das vagas.

Permite testar o sistema sem câmera:
    python gerar_demo.py
    python app.py
"""
from __future__ import annotations

import json
import random
from pathlib import Path

import cv2
import numpy as np

RAIZ = Path(__file__).resolve().parent
LARGURA, ALTURA = 1280, 720
FPS = 15
DURACAO_S = 60
LARG_VAGA = 140
X0 = 80
FILEIRAS = [(110, 320), (400, 610)]  # (y_topo, y_base) de cada fileira
VAGAS_POR_FILEIRA = 8
MARGEM_POLIGONO = 12  # recuo do polígono em relação às faixas pintadas
MARGEM_CARRO = 20

CORES_CARRO = [(40, 40, 180), (180, 60, 30), (30, 30, 30), (200, 200, 200), (40, 140, 40), (20, 160, 220)]


def fundo() -> np.ndarray:
    rng = np.random.default_rng(1)
    img = np.full((ALTURA, LARGURA, 3), 95, dtype=np.uint8)
    ruido = rng.normal(0, 6, (ALTURA, LARGURA, 1)).astype(np.int16)
    img = np.clip(img.astype(np.int16) + ruido, 0, 255).astype(np.uint8)
    for y_topo, y_base in FILEIRAS:
        for i in range(VAGAS_POR_FILEIRA + 1):
            x = X0 + i * LARG_VAGA
            cv2.line(img, (x, y_topo), (x, y_base), (235, 235, 235), 4)
        y_fundo = y_topo if y_topo < 300 else y_base
        cv2.line(img, (X0, y_fundo), (X0 + VAGAS_POR_FILEIRA * LARG_VAGA, y_fundo), (235, 235, 235), 4)
    return img


def retangulos_vagas() -> list[tuple[str, int, int, int, int]]:
    vagas = []
    for f, (y_topo, y_base) in enumerate(FILEIRAS):
        letra = "AB"[f]
        for i in range(VAGAS_POR_FILEIRA):
            x1 = X0 + i * LARG_VAGA
            vagas.append((f"{letra}{i + 1}", x1, y_topo, x1 + LARG_VAGA, y_base))
    return vagas


def desenhar_carro(img: np.ndarray, x1: int, y1: int, x2: int, y2: int, cor: tuple) -> None:
    m = MARGEM_CARRO
    x1, y1, x2, y2 = x1 + m, y1 + m, x2 - m, y2 - m
    cv2.rectangle(img, (x1 + 4, y1 + 4), (x2 + 4, y2 + 4), (50, 50, 50), -1)  # sombra
    cv2.rectangle(img, (x1, y1), (x2, y2), cor, -1)
    cv2.rectangle(img, (x1, y1), (x2, y2), (20, 20, 20), 2)
    altura = y2 - y1
    vidro = (35, 35, 45)
    cv2.rectangle(img, (x1 + 8, y1 + altura // 5), (x2 - 8, y1 + altura // 5 + 30), vidro, -1)
    cv2.rectangle(img, (x1 + 8, y2 - altura // 5 - 22), (x2 - 8, y2 - altura // 5), vidro, -1)
    teto = tuple(min(255, c + 40) for c in cor)
    cv2.rectangle(img, (x1 + 10, y1 + altura // 5 + 38), (x2 - 10, y2 - altura // 5 - 30), teto, -1)
    for yy in (y1 + 10, y2 - 30):  # rodas
        cv2.rectangle(img, (x1 - 4, yy), (x1 + 4, yy + 20), (10, 10, 10), -1)
        cv2.rectangle(img, (x2 - 4, yy), (x2 + 4, yy + 20), (10, 10, 10), -1)


def agenda(total_frames: int, rng: random.Random) -> list[tuple[int, int, tuple]]:
    """Intervalos (inicio, fim, cor) em que a vaga fica ocupada."""
    intervalos, t = [], rng.randint(0, FPS * 8)
    while t < total_frames:
        dur = rng.randint(FPS * 6, FPS * 20)
        intervalos.append((t, t + dur, rng.choice(CORES_CARRO)))
        t += dur + rng.randint(FPS * 3, FPS * 12)
    return intervalos


def main() -> None:
    rng = random.Random(42)
    base = fundo()
    vagas = retangulos_vagas()
    total = FPS * DURACAO_S
    agendas = {vid: agenda(total, rng) for vid, *_ in vagas}

    destino = RAIZ / "data" / "demo.mp4"
    destino.parent.mkdir(parents=True, exist_ok=True)
    escritor = cv2.VideoWriter(str(destino), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (LARGURA, ALTURA))
    if not escritor.isOpened():
        raise SystemExit("Não foi possível criar o vídeo (codec mp4v indisponível).")

    np_rng = np.random.default_rng(7)
    for f in range(total):
        img = base.copy()
        for vid, x1, y1, x2, y2 in vagas:
            for ini, fim, cor in agendas[vid]:
                if ini <= f < fim:
                    desenhar_carro(img, x1, y1, x2, y2, cor)
                    break
        # variação leve de iluminação + ruído do sensor, para simular câmera real
        brilho = 8 * np.sin(f / (FPS * 10) * 2 * np.pi)
        ruido = np_rng.normal(0, 3, img.shape)
        img = np.clip(img.astype(np.float32) + brilho + ruido, 0, 255).astype(np.uint8)
        escritor.write(img)
    escritor.release()

    m = MARGEM_POLIGONO
    cfg = {
        "fonte": "data/demo.mp4",
        "limiar": 0.10,
        "frames_confirmacao": 5,
        "vagas": [
            {"id": vid, "pontos": [[x1 + m, y1 + m], [x2 - m, y1 + m], [x2 - m, y2 - m], [x1 + m, y2 - m]]}
            for vid, x1, y1, x2, y2 in vagas
        ],
    }
    caminho_cfg = RAIZ / "config" / "vagas.json"
    caminho_cfg.parent.mkdir(parents=True, exist_ok=True)
    caminho_cfg.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Vídeo: {destino}\nConfiguração: {caminho_cfg} ({len(vagas)} vagas)")


if __name__ == "__main__":
    main()
