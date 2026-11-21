import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from estacionamento import config as cfgmod  # noqa: E402
from estacionamento.detector import DetectorVagas  # noqa: E402
from gerar_demo import CORES_CARRO, MARGEM_POLIGONO, desenhar_carro  # noqa: E402

# Uma vaga com as mesmas dimensões do vídeo de demonstração
X1, Y1, X2, Y2 = 10, 10, 150, 220
M = MARGEM_POLIGONO
VAGA = {"id": "A1", "pontos": [[X1 + M, Y1 + M], [X2 - M, Y1 + M], [X2 - M, Y2 - M], [X1 + M, Y2 - M]]}


def asfalto(seed=0):
    rng = np.random.default_rng(seed)
    img = np.full((230, 160, 3), 95, np.float32) + rng.normal(0, 6, (230, 160, 1))
    return np.clip(img, 0, 255).astype(np.uint8)


def com_carro(seed=0, cor=CORES_CARRO[0]):
    img = asfalto(seed)
    desenhar_carro(img, X1, Y1, X2, Y2, cor)
    return img


def test_vaga_vazia_e_livre():
    estados, _ = DetectorVagas([VAGA]).processar(asfalto())
    assert estados[0].ocupada is False
    assert estados[0].ocupacao < 0.03


@pytest.mark.parametrize("cor", CORES_CARRO)
def test_vaga_com_carro_e_ocupada(cor):
    estados, _ = DetectorVagas([VAGA]).processar(com_carro(cor=cor))
    assert estados[0].ocupada is True, f"ocupacao={estados[0].ocupacao:.3f}"


def test_mudanca_exige_confirmacao_e_gera_evento():
    det = DetectorVagas([VAGA], frames_confirmacao=3)
    det.processar(asfalto())
    for i in range(2):
        estados, eventos = det.processar(com_carro(i))
        assert estados[0].ocupada is False and eventos == []
    estados, eventos = det.processar(com_carro(5))
    assert estados[0].ocupada is True
    assert len(eventos) == 1 and eventos[0]["vaga"] == "A1" and eventos[0]["ocupada"] is True


def test_leitura_isolada_nao_muda_estado():
    det = DetectorVagas([VAGA], frames_confirmacao=3)
    det.processar(asfalto())
    det.processar(com_carro())  # ruído de 1 frame
    estados, eventos = det.processar(asfalto(1))
    assert estados[0].ocupada is False and eventos == []


def test_config_rejeita_ids_duplicados():
    with pytest.raises(cfgmod.ErroConfig):
        cfgmod.validar({"vagas": [VAGA, VAGA]})


def test_config_rejeita_poligono_com_poucos_pontos():
    with pytest.raises(cfgmod.ErroConfig):
        cfgmod.validar({"vagas": [{"id": "X", "pontos": [[0, 0], [1, 1]]}]})
