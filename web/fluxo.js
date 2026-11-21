"use strict";
/* Aba "Funcionamento do sistema": mostra, ao vivo, as 4 etapas por que passa cada leitura.
 *   1. Coleta       – o sensor da vaga emite uma mensagem (id do sensor + horário de emissão)
 *   2. Transmissão  – a mensagem viaja até o gateway e espera na fila
 *   3. Processamento – o servidor tira uma mensagem por vez da fila e a processa
 *   4. Atualização  – o app recebe o resultado e atualiza a vaga
 * As leituras dos sensores vêm do mesmo estado de vagas usado no resto do painel (window.estacionamento).
 * Os tempos de cada etapa são simulados (e um pouco lentos, para dar para acompanhar a animação).
 */
(() => {
  const T = {
    viagemSensorGateway: 1300, // ms
    viagemGatewayServidor: 800,
    processamento: 900,
    viagemServidorApp: 800,
    statusMin: 90000, // intervalo do "status periódico" de cada sensor
    statusMax: 150000,
    maxLog: 60,
    maxFilaVisivel: 8,
  };

  const $ = (id) => document.getElementById(id);
  const raiz = $("fluxo");
  const camada = $("pacotes");
  const rnd = (a, b) => a + Math.random() * (b - a);
  const suave = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

  let refEstados = null;
  let seq = 0;
  let msgs = [];        // mais recentes primeiro (registro)
  let fila = [];        // mensagens esperando no gateway
  let transito = [];    // mensagens viajando entre etapas
  let servidor = null;  // mensagem em processamento
  let processadas = 0;
  let ultimoRegistro = 0;
  const ultimaLeitura = new Map();
  const proximoStatus = new Map();
  const estadoApp = new Map();

  // ---------- utilidades ----------
  function hora(ms) {
    const d = new Date(ms);
    return d.toLocaleTimeString("pt-BR") + "." + String(d.getMilliseconds()).padStart(3, "0");
  }
  /** Horário de parede de uma etapa: emissão + tempo decorrido no relógio da simulação. */
  const horaEtapa = (m, etapa) => (m.t[etapa] === undefined ? null : m.relogioEmissao + (m.t[etapa] - m.t.emitida));

  function centro(el) {
    const r = el.getBoundingClientRect(), b = raiz.getBoundingClientRect();
    return [r.left - b.left + r.width / 2, r.top - b.top + r.height / 2];
  }

  const classe = (m) => (m.tipo === "status" ? "status" : m.ocupada ? "ocupada" : "livre");
  const textoLeitura = (ocupada) => (ocupada ? "ocupada" : "livre");

  function criarPacote(m) {
    const el = document.createElement("div");
    el.className = "pacote " + classe(m);
    el.innerHTML = `<b>${m.sensor}</b><span>${hora(m.relogioEmissao)}</span>`;
    el.title = `Mensagem #${m.n} · ${m.sensor} · vaga ${m.vaga} · ${textoLeitura(m.ocupada)} · emitida às ${hora(m.relogioEmissao)}`;
    camada.appendChild(el);
    return el;
  }

  function viajar(m, deEl, paraEl, dur, destino, t) {
    transito.push({ m, deEl, paraEl, t0: t, dur, destino, el: criarPacote(m) });
  }

  // ---------- reconstrução quando as vagas mudam ----------
  function reiniciar(estados) {
    transito.forEach((tr) => tr.el.remove());
    msgs = []; fila = []; transito = []; servidor = null; processadas = 0;
    ultimaLeitura.clear(); proximoStatus.clear(); estadoApp.clear();

    $("sensores").innerHTML = estados.map((e) =>
      `<div class="sensor" id="sns-${e.id}"><span class="led"></span><b>SNS-${e.id}</b></div>`).join("") ||
      '<p class="vazio">Nenhuma vaga cadastrada.</p>';
    $("appVagas").innerHTML = estados.map((e) => `<div class="app-vaga" id="app-${e.id}">${e.id}</div>`).join("");
    renderFila(); renderServidor(0); renderApp(); renderRegistro();
  }

  // ---------- etapa 1: coleta ----------
  function emitir(e, tipo, t) {
    const m = {
      n: ++seq, sensor: "SNS-" + e.id, vaga: e.id, ocupada: e.ocupada, tipo,
      relogioEmissao: Date.now(), t: { emitida: t },
    };
    msgs.unshift(m);
    if (msgs.length > T.maxLog) msgs.pop();

    const sensorEl = $("sns-" + e.id);
    sensorEl.classList.remove("emitindo");
    void sensorEl.offsetWidth; // reinicia a animação CSS
    sensorEl.classList.add("emitindo");
    sensorEl.classList.toggle("ocupada", e.ocupada);
    sensorEl.classList.toggle("livre", !e.ocupada);

    viajar(m, sensorEl, $("alvoGateway"), T.viagemSensorGateway, "gateway", t);
    proximoStatus.set(e.id, t + rnd(T.statusMin, T.statusMax));
  }

  // ---------- chegada a cada etapa ----------
  function chegou(tr, t) {
    const m = tr.m;
    if (tr.destino === "gateway") {          // etapa 2: entra na fila
      m.t.gateway = t;
      fila.push(m);
      renderFila();
    } else if (tr.destino === "servidor") {  // etapa 3: começa o processamento
      m.t.inicioProc = t;
      servidor = m;
      renderServidor(0);
    } else if (tr.destino === "app") {       // etapa 4: app atualizado
      m.t.app = t;
      estadoApp.set(m.vaga, m.ocupada);
      renderApp(m.vaga);
    }
  }

  // ---------- desenho ----------
  function renderFila() {
    $("qtdFila").textContent = fila.length;
    const visiveis = fila.slice(0, T.maxFilaVisivel);
    $("fila").innerHTML = visiveis.map((m) =>
      `<li class="${classe(m)}"><b>${m.sensor}</b> <span>#${m.n} · ${hora(m.relogioEmissao)}</span></li>`).join("") +
      (fila.length > T.maxFilaVisivel ? `<li class="mais">+${fila.length - T.maxFilaVisivel} aguardando…</li>` : "") +
      (fila.length ? "" : '<li class="vazio">fila vazia</li>');
  }

  function renderServidor(fracao) {
    const cpu = $("cpu");
    if (servidor) {
      cpu.innerHTML = `Processando <b>#${servidor.n}</b> · ${servidor.sensor}<br><small>vaga ${servidor.vaga} → ${textoLeitura(servidor.ocupada)}</small>`;
      cpu.classList.add("ativo");
    } else {
      cpu.textContent = "Ocioso";
      cpu.classList.remove("ativo");
    }
    $("progresso").style.width = `${Math.round(fracao * 100)}%`;
    $("qtdProc").textContent = processadas;
  }

  function renderApp(vagaAtualizada) {
    let livres = 0;
    estadoApp.forEach((ocupada, id) => {
      if (!ocupada) livres++;
      const el = $("app-" + id);
      if (el) { el.classList.toggle("ocupada", ocupada); el.classList.toggle("livre", !ocupada); }
    });
    $("appLivres").textContent = estadoApp.size ? `${livres} / ${refEstados ? refEstados.length : 0}` : "–";
    if (vagaAtualizada) {
      const el = $("app-" + vagaAtualizada);
      if (el) { el.classList.remove("piscar"); void el.offsetWidth; el.classList.add("piscar"); }
    }
  }

  function renderRegistro() {
    if (!msgs.length) {
      $("logMsgs").innerHTML = '<tr><td colspan="10" class="ajuda">Aguardando mensagens…</td></tr>';
      return;
    }
    const celula = (m, etapa) => { const h = horaEtapa(m, etapa); return h === null ? '<td class="pend">…</td>' : `<td>${hora(h)}</td>`; };
    $("logMsgs").innerHTML = msgs.map((m) => {
      const lat = m.t.app !== undefined ? `${((m.t.app - m.t.emitida) / 1000).toFixed(2)} s` : "…";
      return `<tr>
        <td>#${m.n}</td><td><b>${m.sensor}</b></td><td>${m.vaga}</td>
        <td><span class="tag-leitura ${m.ocupada ? "ocupada" : "livre"}">${textoLeitura(m.ocupada)}</span></td>
        <td>${m.tipo}</td>
        ${celula(m, "emitida")}${celula(m, "gateway")}${celula(m, "processada")}${celula(m, "app")}
        <td class="${m.t.app !== undefined ? "" : "pend"}">${lat}</td></tr>`;
    }).join("");
  }

  // ---------- laço ----------
  function quadro() {
    requestAnimationFrame(quadro);
    const api = window.estacionamento;
    if (!api) return;
    const s = api.estado();
    const t = api.tempo();

    if (s.estados !== refEstados) { refEstados = s.estados; reiniciar(s.estados); }

    // 1. coleta: emite quando a leitura muda, na primeira leitura e periodicamente
    if (!s.pausado) {
      for (const e of s.estados) {
        if (e.ocupada === null || !$("sns-" + e.id)) continue;
        const anterior = ultimaLeitura.get(e.id);
        if (anterior === undefined) emitir(e, "inicial", t);
        else if (anterior !== e.ocupada) emitir(e, "mudança", t);
        else if (t >= proximoStatus.get(e.id)) emitir(e, "status", t);
        ultimaLeitura.set(e.id, e.ocupada);
      }
    }

    // mensagens em trânsito
    for (let i = transito.length - 1; i >= 0; i--) {
      const tr = transito[i];
      if (t - tr.t0 >= tr.dur) {
        tr.el.remove();
        transito.splice(i, 1);
        chegou(tr, tr.t0 + tr.dur);
      }
    }

    // 2 → 3: o gateway libera a próxima mensagem quando o servidor está livre
    const indoAoServidor = transito.some((tr) => tr.destino === "servidor");
    if (!servidor && !indoAoServidor && fila.length) {
      const m = fila.shift();
      renderFila();
      viajar(m, $("alvoGateway"), $("alvoServidor"), T.viagemGatewayServidor, "servidor", t);
    }

    // 3. processamento
    if (servidor) {
      const fracao = Math.min(1, (t - servidor.t.inicioProc) / T.processamento);
      if (fracao >= 1) {
        const m = servidor;
        m.t.processada = m.t.inicioProc + T.processamento;
        servidor = null;
        processadas++;
        renderServidor(0);
        const destino = $("app-" + m.vaga) || $("appVagas");
        viajar(m, $("alvoServidor"), destino, T.viagemServidorApp, "app", m.t.processada);
      } else {
        $("progresso").style.width = `${Math.round(fracao * 100)}%`;
      }
    }

    // posição dos pacotes (só quando a aba está visível)
    if (raiz.offsetParent !== null) {
      for (const tr of transito) {
        const p = suave(Math.min(1, Math.max(0, (t - tr.t0) / tr.dur)));
        const [x0, y0] = centro(tr.deEl), [x1, y1] = centro(tr.paraEl);
        tr.el.style.transform = `translate(${x0 + (x1 - x0) * p}px, ${y0 + (y1 - y0) * p}px) translate(-50%, -50%)`;
        tr.el.style.visibility = "visible";
      }
      if (t - ultimoRegistro > 300 || t < ultimoRegistro) { renderRegistro(); ultimoRegistro = t; }
    }
  }
  requestAnimationFrame(quadro);
})();
