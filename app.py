"""Servidor web do estacionamento monitorado.

Uso:
    python app.py            # abre em http://localhost:5000
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

from flask import Flask, Response, abort, jsonify, render_template, request

from estacionamento import config as cfgmod
from estacionamento.eventos import RepositorioEventos
from estacionamento.monitor import Monitor

RAIZ = Path(__file__).resolve().parent
CAMINHO_CONFIG = RAIZ / "config" / "vagas.json"
CAMINHO_DB = RAIZ / "data" / "eventos.db"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = Flask(__name__)
repo = RepositorioEventos(CAMINHO_DB)
monitor = Monitor(CAMINHO_CONFIG, RAIZ, repo)


# ---------------- Páginas ----------------
@app.get("/")
def painel():
    return render_template("index.html")


@app.get("/configurar")
def configurar():
    return render_template("configurar.html")


# ---------------- Vídeo ----------------
@app.get("/video")
def video():
    """Stream MJPEG com as vagas desenhadas."""

    def gerar():
        while True:
            jpg = monitor.jpeg(anotado=True)
            if jpg:
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
            time.sleep(0.1)

    return Response(gerar(), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.get("/api/frame.jpg")
def frame():
    """Frame sem anotações (usado na tela de configuração)."""
    jpg = monitor.jpeg(anotado=False)
    if not jpg:
        abort(503, "Ainda sem imagem da câmera.")
    return Response(jpg, mimetype="image/jpeg", headers={"Cache-Control": "no-store"})


# ---------------- API ----------------
@app.get("/api/status")
def status():
    return jsonify(monitor.status())


@app.get("/api/eventos")
def eventos():
    limite = min(max(request.args.get("limite", 50, type=int), 1), 500)
    return jsonify(repo.ultimos(limite))


@app.get("/api/config")
def obter_config():
    return jsonify(cfgmod.carregar(CAMINHO_CONFIG))


@app.put("/api/config")
def salvar_config():
    try:
        cfg = cfgmod.salvar(CAMINHO_CONFIG, request.get_json(force=True))
    except cfgmod.ErroConfig as exc:
        return jsonify({"erro": str(exc)}), 400
    monitor.recarregar()
    return jsonify(cfg)


if __name__ == "__main__":
    monitor.iniciar()
    # threaded=True: o stream de vídeo não bloqueia as outras requisições
    app.run(host="0.0.0.0", port=5000, threaded=True, debug=False)
