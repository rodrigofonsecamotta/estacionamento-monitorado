"use strict";
/* Estacionamento Monitorado (versão web).
 * Mesmo algoritmo do detector Python (estacionamento/detector.py), rodando no navegador:
 *   cinza -> blur gaussiano 3x3 -> limiarização adaptativa (inversa) -> mediana 5x5 -> dilatação 3x3
 *   e, por vaga, fração de pixels ativos >= limiar => ocupada (com confirmação por N quadros).
 */
const $ = (id) => document.getElementById(id);
const tela = $("tela");
const ctx = tela.getContext("2d", { willReadFrequently: true });
const video = $("video");

const CFG = { limiar: 0.10, framesConfirmacao: 5, C: 12, raioMedia: 12, intervaloMs: 66 };
const CHAVE = "estacionamento:v2:"; // v2: layout da simulação com corredor mais largo

let fonte = "sim";
let vagas = [];      // [{id, pontos:[[x,y],...]}]
let estados = [];    // estado de detecção por vaga
let mascaras = [];   // Int32Array de índices de pixel por vaga
let formato = "";
let editando = false;
let pontos = [];
let eventos = [];
let streamWebcam = null;
let ultimoPainel = 0;

// Pausa: congela imagem, detecção e o relógio da simulação
let pausado = false;
let pausaInicio = 0;
let pausaTotal = 0;
const congelado = document.createElement("canvas");
const relogio = () => (pausado ? pausaInicio : performance.now()) - pausaTotal;

// ======================= Simulação =======================
const SIM = { W: 1280, H: 720, LARG: 140, X0: 80, FILEIRAS: [[50, 260], [460, 670]], POR: 8, MP: 12, MC: 20 };
const CORES = [[180, 40, 40], [30, 60, 180], [30, 30, 30], [200, 200, 200], [40, 140, 40], [220, 160, 20]];
const rnd = (a, b) => a + Math.random() * (b - a);
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
let fundoSim = null;
const carrosSim = [];

function criarFundoSim() {
  const c = document.createElement("canvas");
  c.width = SIM.W; c.height = SIM.H;
  const g = c.getContext("2d");
  const im = g.createImageData(SIM.W, SIM.H);
  const d = im.data;
  for (let j = 0; j < d.length; j += 4) {
    const v = 95 + (Math.random() + Math.random() + Math.random() - 1.5) * 10; // ruído ~N(0,5)
    d[j] = d[j + 1] = d[j + 2] = v;
    d[j + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  g.strokeStyle = "rgb(235,235,235)";
  g.lineWidth = 4;
  SIM.FILEIRAS.forEach(([yt, yb], f) => {
    for (let i = 0; i <= SIM.POR; i++) {
      const x = SIM.X0 + i * SIM.LARG;
      g.beginPath(); g.moveTo(x, yt); g.lineTo(x, yb); g.stroke();
    }
    const yf = f === 0 ? yt : yb;
    g.beginPath(); g.moveTo(SIM.X0, yf); g.lineTo(SIM.X0 + SIM.POR * SIM.LARG, yf); g.stroke();
  });
  return c;
}

function retangulosSim() {
  const r = [];
  SIM.FILEIRAS.forEach(([yt, yb], f) => {
    for (let i = 0; i < SIM.POR; i++) {
      const x1 = SIM.X0 + i * SIM.LARG;
      r.push({ id: "AB"[f] + (i + 1), x1, y1: yt, x2: x1 + SIM.LARG, y2: yb });
    }
  });
  return r;
}

function vagasPadraoSim() {
  const m = SIM.MP;
  return retangulosSim().map(({ id, x1, y1, x2, y2 }) => ({
    id, pontos: [[x1 + m, y1 + m], [x2 - m, y1 + m], [x2 - m, y2 - m], [x1 + m, y2 - m]],
  }));
}

const INTERVALO_MUDANCA_MS = 5000; // uma vaga muda (carro entra ou sai) a cada 5 s
let proximaMudanca = 0;

function iniciarSim() {
  fundoSim = fundoSim || criarFundoSim();
  if (carrosSim.length) return;
  for (const r of retangulosSim()) {
    carrosSim.push({ ...r, ocupado: Math.random() < 0.5, cor: CORES[(Math.random() * CORES.length) | 0] });
  }
  proximaMudanca = relogio() + INTERVALO_MUDANCA_MS;
}

function desenharCarro(g, x1, y1, x2, y2, cor) {
  const m = SIM.MC;
  x1 += m; y1 += m; x2 -= m; y2 -= m;
  const w = x2 - x1, h = y2 - y1, a = Math.floor(h / 5);
  g.fillStyle = "rgb(50,50,50)"; g.fillRect(x1 + 4, y1 + 4, w, h);          // sombra
  g.fillStyle = rgb(cor); g.fillRect(x1, y1, w, h);                          // carroceria
  g.strokeStyle = "rgb(20,20,20)"; g.lineWidth = 2; g.strokeRect(x1, y1, w, h);
  g.fillStyle = "rgb(35,35,45)";                                             // vidros
  g.fillRect(x1 + 8, y1 + a, w - 16, 30);
  g.fillRect(x1 + 8, y2 - a - 22, w - 16, 22);
  g.fillStyle = rgb(cor.map((c) => Math.min(255, c + 40)));                  // teto
  g.fillRect(x1 + 10, y1 + a + 38, w - 20, (y2 - a - 30) - (y1 + a + 38));
  g.fillStyle = "rgb(10,10,10)";                                             // rodas
  for (const yy of [y1 + 10, y2 - 30]) { g.fillRect(x1 - 4, yy, 8, 20); g.fillRect(x2 - 4, yy, 8, 20); }
}

function desenharSim() {
  const agora = relogio();
  ctx.drawImage(fundoSim, 0, 0);
  if (agora >= proximaMudanca) {
    const c = carrosSim[(Math.random() * carrosSim.length) | 0];
    c.ocupado = !c.ocupado;
    if (c.ocupado) c.cor = CORES[(Math.random() * CORES.length) | 0];
    proximaMudanca = agora + INTERVALO_MUDANCA_MS;
  }
  for (const c of carrosSim) {
    if (c.ocupado) desenharCarro(ctx, c.x1, c.y1, c.x2, c.y2, c.cor);
  }
  // variação leve de iluminação, como numa câmera real
  const b = Math.sin(agora / 10000 * 2 * Math.PI) * 0.06;
  ctx.fillStyle = b > 0 ? `rgba(255,255,255,${b})` : `rgba(0,0,0,${-b})`;
  ctx.fillRect(0, 0, SIM.W, SIM.H);
}

// ======================= Detecção =======================
let buf = null;
function buffers(n, w, h) {
  if (buf && buf.n === n) return buf;
  buf = {
    n,
    cinza: new Float32Array(n), tmp: new Float32Array(n), blur: new Float32Array(n),
    media: new Float32Array(n), bin: new Uint8Array(n), bin2: new Uint8Array(n), saida: new Uint8Array(n),
    integral: new Float64Array((w + 1) * (h + 1)),
  };
  return buf;
}

function integral(src, w, h, I) {
  const W1 = w + 1;
  for (let x = 0; x <= w; x++) I[x] = 0;
  for (let y = 0; y < h; y++) {
    let s = 0;
    const o = y * w, r = (y + 1) * W1, rp = y * W1;
    I[r] = 0;
    for (let x = 0; x < w; x++) { s += src[o + x]; I[r + x + 1] = I[rp + x + 1] + s; }
  }
}

/** out[i] = média de src numa janela (2*raio+1)^2 em torno de i (recortada na borda). */
function mediaJanela(src, w, h, raio, I, out) {
  integral(src, w, h, I);
  const W1 = w + 1;
  for (let y = 0; y < h; y++) {
    const y0 = y - raio < 0 ? 0 : y - raio;
    const y1 = y + raio >= h ? h - 1 : y + raio;
    const a = y0 * W1, b = (y1 + 1) * W1, alt = y1 - y0 + 1;
    for (let x = 0; x < w; x++) {
      const x0 = x - raio < 0 ? 0 : x - raio;
      const x1 = x + raio >= w ? w - 1 : x + raio;
      const s = I[b + x1 + 1] - I[a + x1 + 1] - I[b + x0] + I[a + x0];
      out[y * w + x] = s / ((x1 - x0 + 1) * alt);
    }
  }
}

function binarizar(d, w, h) {
  const n = w * h;
  const B = buffers(n, w, h);
  const { cinza, tmp, blur, media, bin, bin2, saida, integral: I } = B;
  for (let i = 0, j = 0; i < n; i++, j += 4) cinza[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];

  // blur gaussiano 3x3 (sigma=1), separável
  const k0 = 0.27407, k1 = 0.45186;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const e = x > 0 ? cinza[o + x - 1] : cinza[o + x];
      const dd = x < w - 1 ? cinza[o + x + 1] : cinza[o + x];
      tmp[o + x] = k0 * e + k1 * cinza[o + x] + k0 * dd;
    }
  }
  for (let y = 0; y < h; y++) {
    const o = y * w, ac = y > 0 ? o - w : o, ab = y < h - 1 ? o + w : o;
    for (let x = 0; x < w; x++) blur[o + x] = k0 * tmp[ac + x] + k1 * tmp[o + x] + k0 * tmp[ab + x];
  }

  // limiarização adaptativa inversa: pixel mais escuro que (média local - C) => ativo
  mediaJanela(blur, w, h, CFG.raioMedia, I, media);
  for (let i = 0; i < n; i++) bin[i] = blur[i] < media[i] - CFG.C ? 1 : 0;

  // mediana 5x5 em imagem binária = maioria na janela
  mediaJanela(bin, w, h, 2, I, media);
  for (let i = 0; i < n; i++) bin2[i] = media[i] > 0.5 ? 1 : 0;

  // dilatação 3x3
  mediaJanela(bin2, w, h, 1, I, media);
  for (let i = 0; i < n; i++) saida[i] = media[i] > 0 ? 1 : 0;
  return saida;
}

function dentro(x, y, pts) {
  let d = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}

function prepararMascaras(w, h) {
  mascaras = vagas.map((v) => {
    const xs = v.pontos.map((p) => p[0]), ys = v.pontos.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
    const idx = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (dentro(x + 0.5, y + 0.5, v.pontos)) idx.push(y * w + x);
    return Int32Array.from(idx);
  });
  formato = `${w}x${h}`;
}

function processar(bin) {
  const agora = new Date();
  estados.forEach((e, k) => {
    const idx = mascaras[k];
    let s = 0;
    for (let i = 0; i < idx.length; i++) s += bin[idx[i]];
    e.ocupacao = idx.length ? s / idx.length : 0;
    const leitura = e.ocupacao >= CFG.limiar;

    if (e.ocupada === null) { e.ocupada = leitura; e.desde = agora; return; }
    if (leitura === e.ocupada) { e.cand = null; e.cont = 0; return; }
    if (e.cand === leitura) e.cont++; else { e.cand = leitura; e.cont = 1; }
    if (e.cont >= CFG.framesConfirmacao) {
      e.ocupada = leitura; e.desde = agora; e.cand = null; e.cont = 0;
      eventos.unshift({ vaga: e.id, ocupada: leitura, momento: agora });
      if (eventos.length > 100) eventos.pop();
      renderEventos();
    }
  });
}

// ======================= Desenho / painel =======================
function caminho(pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function desenharOverlay() {
  const esc = tela.width / 1280;
  ctx.lineWidth = Math.max(2, 2 * esc);
  ctx.font = `bold ${Math.round(16 * Math.max(esc, 0.6))}px system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";

  vagas.forEach((v, k) => {
    const e = estados[k];
    let cor = "160,160,160";
    if (editando) cor = "37,99,235";
    else if (e && e.ocupada === true) cor = "230,50,50";
    else if (e && e.ocupada === false) cor = "60,200,60";
    caminho(v.pontos);
    ctx.fillStyle = `rgba(${cor},.25)`; ctx.fill();
    ctx.strokeStyle = `rgb(${cor})`; ctx.stroke();
    const cx = v.pontos.reduce((s, p) => s + p[0], 0) / v.pontos.length;
    const cy = v.pontos.reduce((s, p) => s + p[1], 0) / v.pontos.length;
    ctx.fillStyle = "#fff"; ctx.fillText(v.id, cx, cy);
  });

  if (editando && pontos.length) {
    ctx.strokeStyle = ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    pontos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    for (const [x, y] of pontos) { ctx.beginPath(); ctx.arc(x, y, 5 * Math.max(esc, 0.6), 0, 7); ctx.fill(); }
  }

  if (!editando && vagas.length) {
    const livres = estados.filter((e) => e.ocupada === false).length;
    ctx.fillStyle = "rgba(0,0,0,.75)"; ctx.fillRect(0, 0, 230 * Math.max(esc, 0.6), 40 * Math.max(esc, 0.6));
    ctx.fillStyle = "#fff"; ctx.textAlign = "left";
    ctx.fillText(`Livres: ${livres} / ${vagas.length}`, 10, 20 * Math.max(esc, 0.6));
  }

  if (pausado) {
    const s = Math.max(esc, 0.6);
    ctx.fillStyle = "rgba(245,158,11,.9)";
    ctx.fillRect(tela.width - 170 * s, 0, 170 * s, 40 * s);
    ctx.fillStyle = "#111"; ctx.textAlign = "center";
    ctx.fillText("⏸ PAUSADO", tela.width - 85 * s, 20 * s);
  }
}

const hora = (d) => d.toLocaleTimeString("pt-BR");

function renderPainel() {
  const livres = estados.filter((e) => e.ocupada === false).length;
  const ocupadas = estados.filter((e) => e.ocupada === true).length;
  $("livres").textContent = livres;
  $("ocupadas").textContent = ocupadas;
  $("total").textContent = vagas.length;
  $("taxa").textContent = vagas.length ? Math.round((100 * ocupadas) / vagas.length) + "%" : "–";
  $("grade").innerHTML = estados.map((e) => {
    const cls = e.ocupada === null ? "indefinida" : e.ocupada ? "ocupada" : "livre";
    const txt = e.ocupada === null ? "…" : e.ocupada ? "ocupada" : "livre";
    const tip = `índice de ocupação ${(e.ocupacao * 100).toFixed(1)}%` + (e.desde ? ` · desde ${hora(e.desde)}` : "");
    return `<div class="vaga ${cls}" title="${tip}">${e.id}<small>${txt}</small></div>`;
  }).join("");
}

function renderEventos() {
  if (!eventos.length) { $("eventos").innerHTML = '<li class="ajuda">Nenhuma movimentação ainda.</li>'; return; }
  $("eventos").innerHTML = eventos.map((e) => `
    <li><span><strong>${e.vaga}</strong><span class="tag ${e.ocupada ? "entrada" : "saida"}">${e.ocupada ? "entrada" : "saída"}</span></span>
    <span class="hora">${hora(e.momento)}</span></li>`).join("");
}

function alerta(txt) { $("alerta").textContent = txt || ""; $("alerta").hidden = !txt; }

// ======================= Vagas / fontes =======================
function definirVagas(lista, salvar = true) {
  vagas = lista;
  estados = vagas.map((v) => ({ id: v.id, ocupada: null, ocupacao: 0, cand: null, cont: 0, desde: null }));
  formato = "";
  if (salvar) try { localStorage.setItem(CHAVE + "vagas:" + fonte, JSON.stringify(vagas)); } catch (e) {}
  renderPainel();
}

function carregarVagas() {
  let salvas = null;
  try { salvas = JSON.parse(localStorage.getItem(CHAVE + "vagas:" + fonte) || "null"); } catch (e) {}
  definirVagas(Array.isArray(salvas) ? salvas : fonte === "sim" ? vagasPadraoSim() : [], false);
  if (!vagas.length && fonte !== "sim") alerta("Nenhuma vaga cadastrada para esta fonte. Clique em “Editar vagas” e marque os 4 cantos de cada vaga.");
}

function pararWebcam() {
  if (streamWebcam) streamWebcam.getTracks().forEach((t) => t.stop());
  streamWebcam = null;
}

async function trocarFonte(nova, arquivo) {
  if (pausado) definirPausa(false);
  pararWebcam();
  video.pause();
  video.removeAttribute("src"); video.srcObject = null;
  alerta("");
  fonte = nova;
  eventos = []; renderEventos();

  if (nova === "webcam") {
    try {
      streamWebcam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } }, audio: false });
      video.srcObject = streamWebcam;
      await video.play();
    } catch (e) {
      alerta("Não foi possível acessar a webcam (permissão negada ou nenhuma câmera encontrada).");
    }
  } else if (nova === "video" && arquivo) {
    video.src = URL.createObjectURL(arquivo);
    try { await video.play(); } catch (e) { alerta("Não foi possível reproduzir este vídeo."); }
  } else {
    iniciarSim();
  }
  carregarVagas();
}

function obterQuadro() {
  if (fonte === "sim") {
    if (tela.width !== SIM.W || tela.height !== SIM.H) { tela.width = SIM.W; tela.height = SIM.H; }
    desenharSim();
    return true;
  }
  if (video.readyState >= 2 && video.videoWidth) {
    const esc = Math.min(1, 1280 / video.videoWidth);
    const w = Math.round(video.videoWidth * esc), h = Math.round(video.videoHeight * esc);
    if (tela.width !== w || tela.height !== h) { tela.width = w; tela.height = h; }
    ctx.drawImage(video, 0, 0, w, h);
    return true;
  }
  ctx.fillStyle = "#111"; ctx.fillRect(0, 0, tela.width, tela.height);
  ctx.fillStyle = "#aaa"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "20px system-ui, sans-serif";
  ctx.fillText("Aguardando vídeo…", tela.width / 2, tela.height / 2);
  return false;
}

function quadro() {
  const t0 = performance.now();
  let online = false;
  try {
    if (pausado) {
      ctx.drawImage(congelado, 0, 0); // mesma imagem; overlay redesenhado por cima
      online = true;
    } else {
      online = obterQuadro();
    }
    if (online && !pausado && vagas.length && !editando) {
      const w = tela.width, h = tela.height;
      if (formato !== `${w}x${h}`) prepararMascaras(w, h);
      processar(binarizar(ctx.getImageData(0, 0, w, h).data, w, h));
    }
    desenharOverlay();
    if (t0 - ultimoPainel > 300) { renderPainel(); ultimoPainel = t0; }
  } catch (e) {
    console.error(e);
    alerta("Erro ao processar o vídeo: " + e.message);
  }
  $("dot").classList.toggle("on", online && !pausado);
  $("dot").classList.toggle("pausa", pausado);
  setTimeout(quadro, Math.max(0, CFG.intervaloMs - (performance.now() - t0)));
}

// ======================= Interação =======================
$("fonte").addEventListener("change", (e) => {
  if (e.target.value === "video") { $("arquivo").click(); return; }
  trocarFonte(e.target.value);
});
$("arquivo").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) trocarFonte("video", f); else $("fonte").value = fonte;
});

$("limiar").addEventListener("input", (e) => {
  CFG.limiar = parseFloat(e.target.value);
  $("limiarValor").textContent = CFG.limiar.toFixed(2);
});

// ---------- Pausa ----------
function definirPausa(ativo) {
  if (ativo === pausado) return;
  if (ativo) {
    pausaInicio = performance.now();
    pausado = true;
    if (fonte === "video") video.pause();
    obterQuadro(); // quadro limpo (sem overlay), com o relógio já congelado
    congelado.width = tela.width; congelado.height = tela.height;
    congelado.getContext("2d").drawImage(tela, 0, 0);
  } else {
    pausaTotal += performance.now() - pausaInicio;
    pausado = false;
    if (fonte === "video") video.play().catch(() => {});
  }
  const b = $("pausar");
  b.textContent = pausado ? "▶ Continuar" : "⏸ Pausar";
  b.classList.toggle("ativo", pausado);
  b.setAttribute("aria-pressed", String(pausado));
}
$("pausar").onclick = () => definirPausa(!pausado);
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat) return;
  if (e.target.closest("input, select, textarea, button")) return; // não interfere em controles
  e.preventDefault();
  definirPausa(!pausado);
});

// ---------- Abas (Vista 3D / Câmera) ----------
function mostrarAba(aba) {
  document.querySelectorAll(".aba").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === aba));
  $("painel3d").hidden = aba !== "3d";
  $("painelCamera").hidden = aba !== "camera";
  $("painelFluxo").hidden = aba !== "fluxo";
}
document.querySelectorAll(".aba").forEach((b) => (b.onclick = () => mostrarAba(b.dataset.aba)));

// Estado lido pela vista 3D (vista3d.js) a cada quadro
window.estacionamento = {
  estado: () => ({ vagas, estados, largura: tela.width, altura: tela.height, fonte, pausado }),
  tempo: () => relogio(), // relógio que para durante a pausa
  corDoCarro: (id) => {
    if (fonte !== "sim") return null;
    const c = carrosSim.find((c) => c.id === id);
    return c ? c.cor : null;
  },
};

function alternarEdicao(ativo) {
  if (ativo) mostrarAba("camera");
  editando = ativo;
  pontos = [];
  $("editar").textContent = ativo ? "Concluir" : "Editar vagas";
  $("editar").classList.toggle("ativo", ativo);
  $("barraEdicao").hidden = !ativo;
  $("ajudaEdicao").hidden = !ativo;
  tela.classList.toggle("editando", ativo);
  if (!ativo) definirVagas(vagas); // reinicia a detecção com as vagas atuais
}
$("editar").onclick = () => alternarEdicao(!editando);
$("desfazer").onclick = () => pontos.pop();
$("limpar").onclick = () => { pontos = []; definirVagas([]); };
$("padrao").onclick = () => {
  pontos = [];
  try { localStorage.removeItem(CHAVE + "vagas:" + fonte); } catch (e) {}
  definirVagas(fonte === "sim" ? vagasPadraoSim() : [], false);
};

tela.addEventListener("click", (e) => {
  if (!editando) return;
  const r = tela.getBoundingClientRect();
  pontos.push([Math.round(((e.clientX - r.left) * tela.width) / r.width), Math.round(((e.clientY - r.top) * tela.height) / r.height)]);
  if (pontos.length === 4) {
    const ids = new Set(vagas.map((v) => v.id));
    let n = vagas.length + 1;
    while (ids.has("V" + n)) n++;
    definirVagas([...vagas, { id: "V" + n, pontos }]);
    pontos = [];
    alerta("");
  }
});

trocarFonte("sim");
quadro();
