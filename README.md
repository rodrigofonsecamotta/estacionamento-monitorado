# Estacionamento Monitorado — MVP

Sistema que usa uma câmera (ou um vídeo) para identificar **vagas livres e ocupadas** em tempo real, com painel web.

## Funcionalidades
- Detecção por visão computacional (OpenCV) de cada vaga cadastrada.
- Painel web: vídeo ao vivo com vagas em verde/vermelho, contadores, taxa de ocupação e mapa das vagas.
- Histórico de entradas e saídas (SQLite).
- Tela para cadastrar vagas clicando sobre a imagem da câmera.
- Fonte de vídeo: arquivo, webcam (`0`, `1`…) ou câmera IP (`rtsp://...`).
- Vídeo de demonstração sintético para testar sem câmera.

## Instalação (Ubuntu/WSL)
```bash
sudo apt install python3-venv python3-pip   # se ainda não tiver
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Rodando a demonstração
```bash
python gerar_demo.py   # cria data/demo.mp4 e config/vagas.json (16 vagas)
python app.py          # abra http://localhost:5000
```

## Usando com uma câmera real
1. Em **Configurar vagas**, informe a fonte (ex.: `0` para webcam ou `rtsp://usuario:senha@ip:554/stream`) e salve.
2. Clique em *Atualizar imagem* e marque os 4 cantos de cada vaga.
3. Salve. Ajuste o **limiar** se necessário: veja no painel a fração de ocupação de cada vaga
   (`/api/status`, campo `ocupacao`) com ela vazia e ocupada, e escolha um valor entre os dois.

## Como funciona a detecção
1. O frame é convertido para cinza e passa por **limiarização adaptativa**, que realça bordas e texturas.
2. Dentro do polígono de cada vaga mede-se a fração de pixels realçados: um carro tem muitas bordas
   (vidros, rodas, contornos); asfalto vazio, quase nenhuma.
3. Acima do `limiar` → ocupada. O estado só muda após `frames_confirmacao` frames seguidos concordarem,
   evitando falsos alarmes por pessoas passando ou ruído.

## API
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/status` | Totais e estado de cada vaga |
| GET | `/api/eventos?limite=50` | Últimas entradas/saídas |
| GET / PUT | `/api/config` | Lê / grava a configuração |
| GET | `/video` | Stream MJPEG anotado |
| GET | `/api/frame.jpg` | Frame atual sem anotações |

## Testes
```bash
pytest
```

## Estrutura
```
app.py                    servidor Flask (painel + API)
gerar_demo.py             gera vídeo e vagas de demonstração
estacionamento/detector.py  detecção livre/ocupada
estacionamento/monitor.py   thread de captura e processamento
estacionamento/config.py    leitura/validação de config/vagas.json
estacionamento/eventos.py   histórico em SQLite
templates/, static/       interface web
```

## Limitações do MVP e próximos passos
- A abordagem por bordas é sensível a sombras fortes, chuva e mudanças bruscas de luz;
  câmera fixa e bem posicionada (de cima/diagonal) dá os melhores resultados.
- Próximos passos naturais: detecção de veículos com IA (ex.: YOLO) ou classificador treinado por vaga,
  múltiplas câmeras, autenticação no painel, notificações e relatórios de ocupação por horário.

## Versão web (Vercel)
A pasta `web/` contém uma versão estática do sistema, com o mesmo algoritmo rodando no navegador.
Ela usa um estacionamento simulado, a webcam ou um vídeo enviado. Está publicada em
https://estacionamento-monitorado.vercel.app

Para publicar de novo, faça o deploy do conteúdo de `web/` como site estático (sem build).
