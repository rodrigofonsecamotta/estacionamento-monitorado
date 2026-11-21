"""Leitura, validação e gravação do arquivo de configuração (config/vagas.json)."""
from __future__ import annotations

import json
from pathlib import Path

PADRAO = {
    "fonte": "data/demo.mp4",  # arquivo de vídeo, índice de webcam ("0") ou URL RTSP/HTTP
    "limiar": 0.10,  # fração de pixels ativos acima da qual a vaga é ocupada
    "frames_confirmacao": 5,  # frames seguidos necessários para mudar o estado
    "vagas": [],
}


class ErroConfig(ValueError):
    pass


def validar(cfg: dict) -> dict:
    if not isinstance(cfg, dict):
        raise ErroConfig("Configuração deve ser um objeto JSON.")
    resultado = {**PADRAO, **cfg}

    try:
        resultado["limiar"] = float(resultado["limiar"])
        resultado["frames_confirmacao"] = int(resultado["frames_confirmacao"])
    except (TypeError, ValueError):
        raise ErroConfig("'limiar' e 'frames_confirmacao' devem ser numéricos.")
    if not 0 < resultado["limiar"] < 1:
        raise ErroConfig("'limiar' deve estar entre 0 e 1.")
    if resultado["frames_confirmacao"] < 1:
        raise ErroConfig("'frames_confirmacao' deve ser >= 1.")
    resultado["fonte"] = str(resultado["fonte"])

    vagas = resultado["vagas"]
    if not isinstance(vagas, list):
        raise ErroConfig("'vagas' deve ser uma lista.")
    ids = set()
    limpas = []
    for i, v in enumerate(vagas):
        if not isinstance(v, dict) or not str(v.get("id", "")).strip():
            raise ErroConfig(f"Vaga #{i + 1} sem 'id'.")
        vid = str(v["id"]).strip()
        if vid in ids:
            raise ErroConfig(f"Id de vaga duplicado: {vid}")
        ids.add(vid)
        pontos = v.get("pontos")
        if not isinstance(pontos, list) or len(pontos) < 3:
            raise ErroConfig(f"Vaga {vid}: precisa de pelo menos 3 pontos.")
        try:
            pontos = [[int(round(p[0])), int(round(p[1]))] for p in pontos]
        except (TypeError, ValueError, IndexError):
            raise ErroConfig(f"Vaga {vid}: pontos inválidos.")
        limpas.append({"id": vid, "pontos": pontos})
    resultado["vagas"] = limpas
    return resultado


def carregar(caminho: Path) -> dict:
    if not caminho.exists():
        return dict(PADRAO)
    with caminho.open(encoding="utf-8") as f:
        return validar(json.load(f))


def salvar(caminho: Path, cfg: dict) -> dict:
    cfg = validar(cfg)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    tmp = caminho.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(caminho)
    return cfg
