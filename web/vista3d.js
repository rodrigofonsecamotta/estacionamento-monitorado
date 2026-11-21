/* Vista 3D: o estacionamento no meio de uma cidade, com dia e noite.
 * Lê o estado da detecção exposto por app.js (window.estacionamento) e o representa em 3D:
 * vagas com sensor e luz indicadora, carros que manobram para entrar/sair, ruas, prédios e trânsito.
 * O tema (dia/noite) vem do botão do cabeçalho (evento "tema" disparado por app.js).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";

// ---------------- Medidas (1 unidade ≈ 100 px da imagem da câmera) ----------------
const ESCALA = 1 / 100;
const MARGEM = 0.8;      // asfalto do lote além das vagas
const CORREDOR = 1.0;    // da boca da vaga até o meio do corredor
const CALCADA = 0.9;
const RUA = 3.4;
const QUADRA = 10;
const ANEIS = 3;         // quadras em cada direção a partir do estacionamento
const VELOCIDADE = 3.2;  // unidades/s dos carros manobrando
const COR = { livre: new THREE.Color(0x22c55e), ocupada: new THREE.Color(0xef4444), indef: new THREE.Color(0x9ca3af) };
const PINTURAS = [0xf1f1ee, 0xb9bdc3, 0x17191d, 0x4b5058, 0x8e1b1b, 0x1d3866, 0x2f4b3b, 0x6c7076, 0xd8d2c4];

let noite = document.documentElement.dataset.tema === "noite";

const host = document.getElementById("vista3d");
const erro = document.getElementById("erro3d");

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (e) {
  erro.textContent = "Seu navegador não suporta WebGL; a vista 3D não está disponível. Use a aba “Câmera + detecção”.";
  erro.hidden = false;
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
host.appendChild(renderer.domElement);
const ANISO = renderer.capabilities.getMaxAnisotropy();

// ---------------- Cena, câmera e controles ----------------
const cena = new THREE.Scene();
cena.fog = new THREE.Fog(0xc9d6e3, 45, 150);

const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 1200);
const controles = new OrbitControls(camera, renderer.domElement);
controles.enableDamping = true;
controles.dampingFactor = 0.08;
controles.maxPolarAngle = Math.PI / 2.12;
controles.minDistance = 2;
controles.maxDistance = 70;
controles.autoRotateSpeed = 0.3;
let girarSozinho = true;
controles.addEventListener("start", () => (girarSozinho = false));

// ---------------- Utilidades ----------------
function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")];
}

function aleatorio(semente) { // mulberry32: cidade igual a cada reconstrução
  return () => {
    semente |= 0; semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPARTILHADAS = new Set(); // texturas em cache que não devem ser descartadas
function compartilhada(t) { COMPARTILHADAS.add(t); return t; }

function liberar(grupo) {
  grupo.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      for (const k of ["map", "emissiveMap"]) if (m[k] && !COMPARTILHADAS.has(m[k])) m[k].dispose();
      m.dispose();
    });
  });
  grupo.clear();
}

const sombra = (m, recebe = true) => { m.castShadow = true; m.receiveShadow = recebe; return m; };

function hashCor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PINTURAS[Math.abs(h) % PINTURAS.length];
}

// ---------------- Céu: dia (Sky) e noite (esfera estrelada) ----------------
const DIR_SOL = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(135));
const DIR_LUA = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 50), THREE.MathUtils.degToRad(-60));

function criarCeu(escala) {
  const ceu = new Sky();
  ceu.scale.setScalar(escala);
  const u = ceu.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.5;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(DIR_SOL);
  return ceu;
}

function texturaCeuNoite(estrelas) {
  const [c, g] = canvas(2048, 1024);
  const gr = g.createLinearGradient(0, 0, 0, 1024);
  gr.addColorStop(0, "#02040b");
  gr.addColorStop(0.38, "#07102a");
  gr.addColorStop(0.5, "#2a2a3e");   // brilho da cidade no horizonte
  gr.addColorStop(0.53, "#141522");
  gr.addColorStop(1, "#05060a");
  g.fillStyle = gr; g.fillRect(0, 0, 2048, 1024);
  if (estrelas) {
    for (let i = 0; i < 1400; i++) {
      const y = Math.random() * 470, a = 0.35 + Math.random() * 0.65 * (1 - y / 520);
      g.fillStyle = `rgba(255,255,255,${a})`;
      const s = Math.random() < 0.92 ? 1 : 2;
      g.fillRect(Math.random() * 2048, y, s, s);
    }
    // lua
    const [lx, ly] = [1500, 210];
    const lg = g.createRadialGradient(lx, ly, 0, lx, ly, 60);
    lg.addColorStop(0, "rgba(255,255,240,1)"); lg.addColorStop(0.3, "rgba(240,240,225,.95)");
    lg.addColorStop(0.36, "rgba(200,210,255,.25)"); lg.addColorStop(1, "rgba(200,210,255,0)");
    g.fillStyle = lg; g.fillRect(lx - 60, ly - 60, 120, 120);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function criarEsferaNoite(raio, estrelas) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(raio, 48, 24),
    new THREE.MeshBasicMaterial({ map: texturaCeuNoite(estrelas), side: THREE.BackSide, fog: false, depthWrite: false })
  );
}

const ceuDia = criarCeu(500);
const ceuNoite = criarEsferaNoite(500, true);
cena.add(ceuDia, ceuNoite);

// reflexos do ambiente (pintura, vidros) para dia e noite
const pmrem = new THREE.PMREMGenerator(renderer);
const envDia = (() => { const s = new THREE.Scene(); s.add(criarCeu(50)); return pmrem.fromScene(s, 0.02).texture; })();
const envNoite = (() => { const s = new THREE.Scene(); s.add(criarEsferaNoite(50, false)); return pmrem.fromScene(s, 0.04).texture; })();

const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x3b4a2f, 0.35);
const sol = new THREE.DirectionalLight(0xfff1dc, 3.0);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
sol.shadow.bias = -0.0003;
sol.shadow.normalBias = 0.03;
sol.shadow.camera.far = 140;
cena.add(hemi, sol, sol.target);

// ---------------- Texturas procedurais ----------------
function texturaRepetida(desenhar, tam, rep) {
  const [c, g] = canvas(tam, tam);
  desenhar(g, tam);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  return t;
}

function ruido(g, tam, base, amp) {
  g.fillStyle = base; g.fillRect(0, 0, tam, tam);
  const im = g.getImageData(0, 0, tam, tam), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(im, 0, 0);
}

const TEX_GRAMA = compartilhada(texturaRepetida((g, t) => {
  g.fillStyle = "#4d6b35"; g.fillRect(0, 0, t, t);
  for (let i = 0; i < 9000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? "rgba(30,50,20,.35)" : v < 0.85 ? "rgba(110,140,70,.35)" : "rgba(150,150,90,.3)";
    g.fillRect(Math.random() * t, Math.random() * t, 1 + Math.random() * 2, 1 + Math.random() * 3);
  }
}, 256, 1));
const TEX_RUA = compartilhada(texturaRepetida((g, t) => ruido(g, t, "#3c3f44", 22), 256, 1));
const TEX_CALCADA = compartilhada(texturaRepetida((g, t) => {
  ruido(g, t, "#b9b5ab", 14);
  g.strokeStyle = "rgba(90,88,82,.45)"; g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * t / 4); g.lineTo(t, i * t / 4); g.moveTo(i * t / 4, 0); g.lineTo(i * t / 4, t); g.stroke(); }
}, 256, 1));

function radial(stops, tam = 128) {
  const [c, g] = canvas(tam, tam);
  const gr = g.createRadialGradient(tam / 2, tam / 2, 0, tam / 2, tam / 2, tam / 2);
  stops.forEach(([p, cor]) => gr.addColorStop(p, cor));
  g.fillStyle = gr; g.fillRect(0, 0, tam, tam);
  return compartilhada(new THREE.CanvasTexture(c));
}
const TEX_SOMBRA = radial([[0, "rgba(0,0,0,.85)"], [0.6, "rgba(0,0,0,.35)"], [1, "rgba(0,0,0,0)"]]);
const TEX_BRILHO = radial([[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,255,255,.55)"], [1, "rgba(255,255,255,0)"]], 64);
const TEX_POCA = radial([[0, "rgba(255,255,255,.9)"], [0.45, "rgba(255,255,255,.35)"], [1, "rgba(255,255,255,0)"]]);

// fachadas: 8 x 8 janelas por textura; mapa (dia) + emissivo (janelas acesas à noite)
const ESTILOS = [
  { parede: "#c9b79c", moldura: "#e8e0d0", vidro: ["#3b4a5c", "#1d2530"], jw: 0.5, jh: 0.55 },  // bege
  { parede: "#9a9da1", moldura: "#b8bbbf", vidro: ["#41536a", "#1f2835"], jw: 0.56, jh: 0.5 },  // concreto
  { parede: "#8e4a36", moldura: "#d8d0c4", vidro: ["#3a4655", "#1b222b"], jw: 0.44, jh: 0.56 }, // tijolo
  { parede: "#5d7a90", moldura: "#7d9bb0", vidro: ["#8fb3cf", "#2b4a66"], jw: 0.9, jh: 0.82 },  // vidro azul
  { parede: "#e7e5df", moldura: "#ffffff", vidro: ["#475769", "#222b36"], jw: 0.5, jh: 0.5 },   // branco
  { parede: "#3c434e", moldura: "#5a616c", vidro: ["#6e8399", "#1a2432"], jw: 0.82, jh: 0.72 }, // escuro moderno
];
const FACHADAS = ESTILOS.map((e) => {
  const N = 8, tam = 512, cel = tam / N;
  const [c, g] = canvas(tam, tam);
  const [ce, ge] = canvas(tam, tam);
  g.fillStyle = e.parede; g.fillRect(0, 0, tam, tam);
  ge.fillStyle = "#000"; ge.fillRect(0, 0, tam, tam);
  for (let i = 0; i < 1600; i++) { // textura da parede
    g.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,.05)" : "rgba(255,255,255,.05)";
    g.fillRect(Math.random() * tam, Math.random() * tam, 2, 2);
  }
  const acesas = ["#ffd38a", "#ffe2a8", "#fff0cc", "#ffc978", "#d6e6ff"];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const w = cel * e.jw, h = cel * e.jh, x0 = x * cel + (cel - w) / 2, y0 = y * cel + (cel - h) / 2;
    g.fillStyle = e.moldura; g.fillRect(x0 - 2, y0 - 2, w + 4, h + 4);
    const gr = g.createLinearGradient(0, y0, 0, y0 + h);
    gr.addColorStop(0, e.vidro[0]); gr.addColorStop(1, e.vidro[1]);
    g.fillStyle = gr; g.fillRect(x0, y0, w, h);
    if (Math.random() < 0.4) { // janela acesa à noite (com cortina parcial às vezes)
      ge.fillStyle = acesas[(Math.random() * acesas.length) | 0];
      const hh = Math.random() < 0.3 ? h * (0.4 + Math.random() * 0.4) : h;
      ge.fillRect(x0, y0 + (h - hh), w, hh);
    }
  }
  const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO; return t; };
  return { mapa: compartilhada(mk(c)), emissivo: compartilhada(mk(ce)), vidro: e.jw > 0.8 };
});

/** Asfalto do lote: granulado, desgaste, manchas de óleo, faixas e números pintados. */
function texturaAsfalto(infos, Wl, Hl) {
  const k = 2048 / Math.max(Wl, Hl);
  const [c, g] = canvas(Math.round(Wl * k), Math.round(Hl * k));
  const P = (v) => [(v.x + Wl / 2) * k, (v.z + Hl / 2) * k];
  g.fillStyle = "#4a4d52"; g.fillRect(0, 0, c.width, c.height);
  const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(im, 0, 0);
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height, r = (0.6 + Math.random() * 2.2) * k;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, Math.random() < 0.6 ? "rgba(0,0,0,.10)" : "rgba(255,255,255,.05)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.strokeStyle = "rgba(20,20,22,.55)"; g.lineWidth = Math.max(1, 0.012 * k);
  for (let i = 0; i < 12; i++) {
    let x = Math.random() * c.width, y = Math.random() * c.height;
    g.beginPath(); g.moveTo(x, y);
    for (let j = 0; j < 10; j++) { x += (Math.random() - 0.5) * 0.35 * k; y += (Math.random() - 0.5) * 0.35 * k; g.lineTo(x, y); }
    g.stroke();
  }
  for (const inf of infos) {
    const [ox, oy] = P(inf.centro.clone().addScaledVector(inf.entrada, -inf.comp * 0.22));
    const ro = inf.larg * 0.28 * k;
    const gr = g.createRadialGradient(ox, oy, 0, ox, oy, ro);
    gr.addColorStop(0, "rgba(12,12,14,.45)"); gr.addColorStop(1, "rgba(12,12,14,0)");
    g.fillStyle = gr; g.fillRect(ox - ro, oy - ro, 2 * ro, 2 * ro);

    g.strokeStyle = "rgba(236,236,226,.9)"; g.lineWidth = 0.07 * k; g.lineCap = "square";
    const n = inf.pts.length;
    for (let i = 0; i < n; i++) {
      if (i === inf.bordaCorredor) continue;
      const [x0, y0] = P(inf.pts[i]), [x1, y1] = P(inf.pts[(i + 1) % n]);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    const [tx, ty] = P(inf.centro.clone().addScaledVector(inf.entrada, inf.comp * 0.5 + 0.18));
    g.save();
    g.translate(tx, ty);
    g.rotate(Math.atan2(-inf.entrada.x, inf.entrada.z));
    g.font = `700 ${Math.round(0.26 * k)}px system-ui, sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "rgba(236,236,226,.9)";
    g.fillText(inf.id, 0, 0);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  return t;
}

// ---------------- Registro do que muda entre dia e noite ----------------
const luzesNoite = { janelas: [], lampadas: [], pocas: [], refletores: [], brilhosLed: [] };
const carros = new Set(); // todos os carros na cena (para os faróis)

// ---------------- Carro ----------------
function perfilCarroceria(L, y0, hb, r, zRoda, ra) {
  const s = new THREE.Shape();
  s.moveTo(-0.5 * L, y0 + 0.12 * hb);
  s.lineTo(-0.47 * L, y0);
  const phi = Math.asin(Math.min(1, (r - y0) / ra));
  const dx = Math.sqrt(Math.max(0, ra * ra - (r - y0) ** 2));
  for (const zc of [-zRoda, zRoda]) {
    s.lineTo(zc - dx, y0);
    s.absarc(zc, r, ra, Math.PI + phi, -phi, true); // caixa de roda
  }
  s.lineTo(0.47 * L, y0);
  for (const [z, y] of [[0.5, 0.15], [0.5, 0.6], [0.46, 0.86], [0.18, 1], [-0.3, 1], [-0.47, 0.9], [-0.5, 0.6]]) s.lineTo(z * L, y0 + y * hb);
  s.closePath();
  return s;
}

function perfilCabine(L, base, c) {
  const s = new THREE.Shape();
  [[0.17, 0], [0.0, 1], [-0.23, 1], [-0.38, 0]].forEach(([z, y], i) => (i ? s.lineTo(z * L, base + y * c) : s.moveTo(z * L, base + y * c)));
  s.closePath();
  return s;
}

function extrudarLargura(perfil, largura, bisel) {
  const prof = Math.max(0.01, largura - 2 * bisel);
  const g = new THREE.ExtrudeGeometry(perfil, { depth: prof, bevelEnabled: true, bevelThickness: bisel, bevelSize: bisel, bevelSegments: 3, curveSegments: 10 });
  g.rotateY(-Math.PI / 2);
  g.translate(prof / 2, 0, 0);
  return g;
}

/** Carro com a frente para +Z local. tipo: "lote" | "transito" | "parado". */
function criarCarro(cor, comp, larg, tipo) {
  const L = Math.min(comp * 0.84, 2.3);
  const W = Math.min(larg * 0.62, L * 0.43);
  const r = L * 0.085, y0 = r * 0.55, hb = L * 0.17, c = L * 0.135;
  const zRoda = 0.32 * L, bisel = 0.03;
  const grupo = new THREE.Group();

  const pintura = new THREE.MeshPhysicalMaterial({ color: cor, metalness: 0.5, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
  const vidro = new THREE.MeshPhysicalMaterial({ color: 0x0c1016, metalness: 0.2, roughness: 0.05, clearcoat: 1 });
  const plastico = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.7 });
  const pneu = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 });
  const aro = new THREE.MeshStandardMaterial({ color: 0xc9cdd3, metalness: 1, roughness: 0.28 });
  const farol = new THREE.MeshStandardMaterial({ color: 0xf5f3ea, emissive: 0xfff3d6, emissiveIntensity: 0.2, roughness: 0.1 });
  const lanterna = new THREE.MeshStandardMaterial({ color: 0x5b0b0b, emissive: 0xff2a2a, emissiveIntensity: 0.35, roughness: 0.2 });
  const placa = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.5 });

  grupo.add(sombra(new THREE.Mesh(extrudarLargura(perfilCarroceria(L, y0, hb, r, zRoda, r * 1.12), W, bisel), pintura)));
  grupo.add(sombra(new THREE.Mesh(extrudarLargura(perfilCabine(L, y0 + hb, c), W * 0.84, 0.025), vidro)));
  const teto = sombra(new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.018, L * 0.2), pintura));
  teto.position.set(0, y0 + hb + c + 0.03, -0.115 * L);
  grupo.add(teto);

  const rodas = [];
  const lp = W * 0.2;
  const geoPneu = new THREE.CylinderGeometry(r, r, lp, 28).rotateZ(Math.PI / 2);
  const geoAro = new THREE.CylinderGeometry(r * 0.62, r * 0.62, lp * 1.04, 6).rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const roda = new THREE.Group();
    roda.add(sombra(new THREE.Mesh(geoPneu, pneu)), new THREE.Mesh(geoAro, aro));
    roda.position.set(sx * (W / 2 + bisel - lp / 2 - 0.004), r, sz * zRoda);
    grupo.add(roda);
    rodas.push(roda);
  }

  const frente = 0.5 * L + bisel + 0.004;
  const geoLuz = new THREE.BoxGeometry(W * 0.22, hb * 0.14, 0.02);
  const brilhosFarol = [], brilhosLanterna = [];
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(geoLuz, farol); f.position.set(sx * W * 0.31, y0 + hb * 0.62, frente); grupo.add(f);
    const t = new THREE.Mesh(geoLuz, lanterna); t.position.set(sx * W * 0.31, y0 + hb * 0.66, -frente); grupo.add(t);
    const esp = sombra(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.03), pintura));
    esp.position.set(sx * (W / 2 + bisel + 0.025), y0 + hb + 0.02, 0.15 * L); grupo.add(esp);

    const bf = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_BRILHO, color: 0xfff1d0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    bf.position.set(sx * W * 0.31, y0 + hb * 0.62, frente + 0.05); bf.scale.setScalar(0.45); bf.visible = false;
    const bl = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_BRILHO, color: 0xff3030, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    bl.position.set(sx * W * 0.31, y0 + hb * 0.66, -frente - 0.05); bl.scale.setScalar(0.3); bl.visible = false;
    grupo.add(bf, bl);
    brilhosFarol.push(bf); brilhosLanterna.push(bl);
  }
  const grade = new THREE.Mesh(new THREE.BoxGeometry(W * 0.36, hb * 0.16, 0.02), plastico);
  grade.position.set(0, y0 + hb * 0.4, frente); grupo.add(grade);
  for (const z of [frente + 0.002, -frente - 0.002]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(W * 0.24, hb * 0.13, 0.01), placa);
    p.position.set(0, y0 + hb * 0.25, z); grupo.add(p);
  }

  const contato = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.35, L * 1.1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: TEX_SOMBRA, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false })
  );
  contato.position.y = 0.007;
  grupo.add(contato);

  // facho do farol no chão (só à noite)
  const facho = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.6, L * 1.3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: TEX_POCA, color: 0xfff0c8, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  facho.position.set(0, 0.012, frente + L * 0.65);
  facho.visible = false;
  grupo.add(facho);

  const carro = { grupo, rodas, farol, lanterna, brilhosFarol, brilhosLanterna, facho, raio: r, tipo, movendo: tipo === "transito", freio: false };
  carros.add(carro);
  luzesCarro(carro);
  return carro;
}

function luzesCarro(c) {
  const faroisLigados = noite && (c.movendo || c.tipo === "transito");
  c.farol.emissiveIntensity = faroisLigados ? 4 : c.movendo ? 0.8 : 0.15;
  c.brilhosFarol.forEach((s) => (s.visible = faroisLigados));
  c.facho.visible = faroisLigados;
  const lanternaAcesa = c.freio || faroisLigados;
  c.lanterna.emissiveIntensity = c.freio ? 2.6 : faroisLigados ? 1.4 : 0.35;
  c.brilhosLanterna.forEach((s) => { s.visible = noite && lanternaAcesa; s.scale.setScalar(c.freio ? 0.4 : 0.28); });
}

function removerCarro(c) {
  carros.delete(c);
  c.grupo.parent?.remove(c.grupo);
  liberar(c.grupo);
}

// ---------------- Elementos da cidade ----------------
function criarArvore(rand) {
  const g = new THREE.Group();
  const tronco = sombra(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.0, 8), new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 })));
  tronco.position.y = 0.5;
  g.add(tronco);
  const tons = [0x3f6b2f, 0x4d7a35, 0x355e29, 0x5a8a3c];
  for (let i = 0; i < 3; i++) {
    const copa = sombra(new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42 + rand() * 0.22, 1),
      new THREE.MeshStandardMaterial({ color: tons[(rand() * tons.length) | 0], roughness: 0.9, flatShading: true })
    ));
    copa.position.set((rand() - 0.5) * 0.45, 1.15 + rand() * 0.45, (rand() - 0.5) * 0.45);
    g.add(copa);
  }
  g.scale.setScalar(0.85 + rand() * 0.4);
  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

const MAT_METAL = new THREE.MeshStandardMaterial({ color: 0x3f454d, metalness: 0.7, roughness: 0.35 });
const MAT_LAMPADA = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, emissive: 0xffd9a0, emissiveIntensity: 0.15 });
luzesNoite.lampadas.push(MAT_LAMPADA);

/** Poste do estacionamento (com refletor de verdade à noite). */
function criarPosteLote() {
  const g = new THREE.Group();
  const haste = sombra(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 3.2, 12), MAT_METAL));
  haste.position.y = 1.6;
  const braco = sombra(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.045, 0.06), MAT_METAL));
  braco.position.set(0.33, 3.15, 0);
  const cabeca = sombra(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.2), MAT_METAL));
  cabeca.position.set(0.62, 3.12, 0);
  const lente = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.01, 0.15), MAT_LAMPADA);
  lente.position.set(0.62, 3.08, 0);
  const refletor = new THREE.SpotLight(0xffe2b0, 60, 16, Math.PI / 3, 0.7, 2);
  refletor.position.set(0.62, 3.0, 0);
  refletor.target.position.set(2.2, 0, 0);
  refletor.visible = noite;
  g.add(haste, braco, cabeca, lente, refletor, refletor.target);
  luzesNoite.refletores.push(refletor);
  return g;
}

/** Prédio: caixa com fachada texturizada (janelas acesas à noite) e detalhes no telhado. */
const MAT_TELHADO = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.95 });
const MAT_EQUIP = new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.7, metalness: 0.3 });
function criarPredio(w, d, h, rand) {
  const f = FACHADAS[(rand() * FACHADAS.length) | 0];
  const lado = (largura) => {
    const mapa = f.mapa.clone(), emi = f.emissivo.clone();
    const ox = Math.floor(rand() * 8) / 8, oy = Math.floor(rand() * 8) / 8;
    for (const t of [mapa, emi]) { t.repeat.set(largura / 0.9 / 8, h / 0.8 / 8); t.offset.set(ox, oy); }
    const m = new THREE.MeshStandardMaterial({
      map: mapa, emissiveMap: emi, emissive: 0xffffff, emissiveIntensity: noite ? 1.1 : 0,
      roughness: f.vidro ? 0.25 : 0.8, metalness: f.vidro ? 0.35 : 0.05,
    });
    luzesNoite.janelas.push(m);
    return m;
  };
  const ladoX = lado(d), ladoZ = lado(w);
  const predio = sombra(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [ladoX, ladoX, MAT_TELHADO, MAT_TELHADO, ladoZ, ladoZ]));
  predio.position.y = h / 2 + 0.12;
  const g = new THREE.Group();
  g.add(predio);
  // platibanda e equipamentos no telhado
  const borda = sombra(new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.12, d + 0.06), MAT_TELHADO));
  borda.position.y = h + 0.12 + 0.06;
  g.add(borda);
  const n = (rand() * 3) | 0;
  for (let i = 0; i < n; i++) {
    const s = 0.3 + rand() * 0.5;
    const eq = sombra(new THREE.Mesh(new THREE.BoxGeometry(s, 0.25 + rand() * 0.35, s * (0.6 + rand() * 0.8)), MAT_EQUIP));
    eq.position.set((rand() - 0.5) * (w - s - 0.3), h + 0.12 + 0.25, (rand() - 0.5) * (d - s - 0.3));
    g.add(eq);
  }
  return g;
}

// ---------------- Grupos e estado ----------------
const grupoCidade = new THREE.Group();
const grupoLote = new THREE.Group();
const grupoVagas = new THREE.Group();
const grupoCarros = new THREE.Group();
cena.add(grupoCidade, grupoLote, grupoVagas, grupoCarros);

const objetos = [];   // uma entrada por vaga
const transito = [];  // carros circulando nas ruas
let geo = null;       // medidas do lote/cidade atuais
let refEstados = null;
let refTamanho = "";

// ---------------- Construção ----------------
function intervalos(meio) {
  const lista = [[-meio, meio]];
  let a = meio, b = -meio;
  for (let i = 0; i < ANEIS; i++) {
    a += RUA; lista.push([a, a + QUADRA]); a += QUADRA;
    b -= RUA; lista.unshift([b - QUADRA, b]); b -= QUADRA;
  }
  return lista;
}

function construirCidade(cxh, czh, entradas, rand) {
  const ix = intervalos(cxh), iz = intervalos(czh);
  const E = Math.max(ix[ix.length - 1][1], iz[iz.length - 1][1]) + RUA;
  const ruasX = [], ruasZ = []; // centros das ruas
  for (let i = 0; i < ix.length - 1; i++) ruasX.push((ix[i][1] + ix[i + 1][0]) / 2);
  for (let i = 0; i < iz.length - 1; i++) ruasZ.push((iz[i][1] + iz[i + 1][0]) / 2);
  ruasX.unshift(ix[0][0] - RUA / 2); ruasX.push(ix[ix.length - 1][1] + RUA / 2);
  ruasZ.unshift(iz[0][0] - RUA / 2); ruasZ.push(iz[iz.length - 1][1] + RUA / 2);

  // chão: gramado distante + asfalto das ruas
  const grama = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: TEX_GRAMA.clone(), roughness: 1 }));
  grama.material.map.repeat.set(200, 200);
  grama.position.y = -0.03;
  grama.receiveShadow = true;
  const rua = new THREE.Mesh(new THREE.PlaneGeometry(2 * E, 2 * E).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: TEX_RUA.clone(), roughness: 0.9 }));
  rua.material.map.repeat.set(E / 2, E / 2);
  rua.position.y = -0.005;
  rua.receiveShadow = true;
  grupoCidade.add(grama, rua);

  // sinalização horizontal (faixas tracejadas e de pedestres) com instâncias
  const tmp = new THREE.Object3D();
  const tracos = [], zebras = [];
  const naRua = (v, centros) => centros.some((c) => Math.abs(v - c) < RUA / 2 + 1.1);
  for (const x of ruasX) for (let z = -E; z <= E; z += 1.5) if (!naRua(z, ruasZ)) tracos.push([x, z, 0]);
  for (const z of ruasZ) for (let x = -E; x <= E; x += 1.5) if (!naRua(x, ruasX)) tracos.push([x, z, Math.PI / 2]);
  for (const x of ruasX) for (const z of ruasZ) {
    for (const s of [-1, 1]) {
      for (let k = -RUA / 2 + 0.35; k <= RUA / 2 - 0.3; k += 0.45) {
        zebras.push([x + k, z + s * (RUA / 2 + 0.55), 0]);         // atravessa a rua vertical
        zebras.push([x + s * (RUA / 2 + 0.55), z + k, Math.PI / 2]); // atravessa a rua horizontal
      }
    }
  }
  const matFaixa = new THREE.MeshStandardMaterial({ color: 0xe9e6da, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const matAmarela = new THREE.MeshStandardMaterial({ color: 0xe0b23a, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const instancias = (geom, mat, lista) => {
    const im = new THREE.InstancedMesh(geom, mat, lista.length);
    lista.forEach(([x, z, ry], i) => { tmp.position.set(x, 0.002, z); tmp.rotation.set(0, ry, 0); tmp.updateMatrix(); im.setMatrixAt(i, tmp.matrix); });
    im.receiveShadow = true;
    grupoCidade.add(im);
  };
  instancias(new THREE.PlaneGeometry(0.1, 0.7).rotateX(-Math.PI / 2), matAmarela, tracos);
  instancias(new THREE.PlaneGeometry(0.25, 0.9).rotateX(-Math.PI / 2), matFaixa, zebras);

  // quadras
  const postes = []; // [x, z, nx, nz] posição e direção da rua
  for (let a = 0; a < ix.length; a++) for (let b = 0; b < iz.length; b++) {
    const [x0, x1] = ix[a], [z0, z1] = iz[b];
    const central = a === ANEIS && b === ANEIS;
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;

    if (central) {
      // calçada em volta do lote, com acesso de veículos na direção do corredor
      calcadaCentral(cxh, czh, entradas);
      continue;
    }

    const calcada = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), new THREE.MeshStandardMaterial({ map: TEX_CALCADA.clone(), roughness: 0.95 }));
    calcada.material.map.repeat.set(w / 1.2, d / 1.2);
    calcada.position.set(cx, 0.06, cz);
    calcada.receiveShadow = true;
    grupoCidade.add(calcada);

    // postes e árvores ao longo do meio-fio
    for (const [px0, pz0, px1, pz1, nx, nz] of [[x0, z0, x1, z0, 0, -1], [x0, z1, x1, z1, 0, 1], [x0, z0, x0, z1, -1, 0], [x1, z0, x1, z1, 1, 0]]) {
      const comp = Math.hypot(px1 - px0, pz1 - pz0);
      for (let s = 2; s < comp - 1.5; s += 6.5) {
        const t = s / comp, x = px0 + (px1 - px0) * t - nx * 0.35, z = pz0 + (pz1 - pz0) * t - nz * 0.35;
        postes.push([x, z, nx, nz]);
        if (rand() < 0.45) {
          const t2 = (s + 3.2) / comp;
          if (t2 < 0.95) {
            const arv = criarArvore(rand);
            arv.position.set(px0 + (px1 - px0) * t2 - nx * 0.45, 0.12, pz0 + (pz1 - pz0) * t2 - nz * 0.45);
            arv.scale.multiplyScalar(0.8);
            grupoCidade.add(arv);
          }
        }
      }
    }

    const ix0 = x0 + CALCADA, ix1 = x1 - CALCADA, iz0 = z0 + CALCADA, iz1 = z1 - CALCADA;
    if (rand() < 0.14) { // praça
      const praca = new THREE.Mesh(new THREE.BoxGeometry(ix1 - ix0, 0.14, iz1 - iz0), new THREE.MeshStandardMaterial({ map: TEX_GRAMA.clone(), roughness: 1 }));
      praca.material.map.repeat.set(4, 4);
      praca.position.set(cx, 0.07, cz);
      praca.receiveShadow = true;
      grupoCidade.add(praca);
      for (let i = 0; i < 7; i++) {
        const arv = criarArvore(rand);
        arv.position.set(ix0 + 0.8 + rand() * (ix1 - ix0 - 1.6), 0.14, iz0 + 0.8 + rand() * (iz1 - iz0 - 1.6));
        grupoCidade.add(arv);
      }
      continue;
    }

    // lotes de prédios: 1–3 em cada direção; mais altos longe do estacionamento
    const nx = 1 + ((rand() * 2.4) | 0), nz = 1 + ((rand() * 2.4) | 0);
    const dist = Math.hypot(cx, cz);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const pw = (ix1 - ix0) / nx, pd = (iz1 - iz0) / nz;
      const bw = pw - 0.25 - rand() * 0.6, bd = pd - 0.25 - rand() * 0.6;
      const alto = rand() < 0.12 ? 1.9 : 1;
      const h = (2.4 + rand() * 6 + Math.min(dist / 6, 6)) * alto;
      const p = criarPredio(bw, bd, h, rand);
      p.position.set(ix0 + pw * (i + 0.5), 0, iz0 + pd * (j + 0.5));
      grupoCidade.add(p);
    }
  }

  // postes de rua (instâncias) + "poças" de luz no chão à noite
  const geoHaste = new THREE.CylinderGeometry(0.035, 0.05, 3.0, 8).translate(0, 1.5, 0);
  const geoCabeca = new THREE.BoxGeometry(0.36, 0.07, 0.16);
  const geoPoca = new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2);
  const matPoca = new THREE.MeshBasicMaterial({ map: TEX_POCA, color: 0xffc77a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const hastes = new THREE.InstancedMesh(geoHaste, MAT_METAL, postes.length);
  const cabecas = new THREE.InstancedMesh(geoCabeca, MAT_LAMPADA, postes.length);
  const pocas = new THREE.InstancedMesh(geoPoca, matPoca, postes.length);
  postes.forEach(([x, z, nx, nz], i) => {
    tmp.rotation.set(0, Math.atan2(nx, nz), 0);
    tmp.position.set(x, 0.12, z); tmp.updateMatrix(); hastes.setMatrixAt(i, tmp.matrix);
    tmp.position.set(x + nx * 0.4, 3.08, z + nz * 0.4); tmp.updateMatrix(); cabecas.setMatrixAt(i, tmp.matrix);
    tmp.position.set(x + nx * 1.3, 0.02, z + nz * 1.3); tmp.updateMatrix(); pocas.setMatrixAt(i, tmp.matrix);
  });
  hastes.castShadow = true;
  pocas.visible = noite;
  luzesNoite.pocas.push(pocas);
  grupoCidade.add(hastes, cabecas, pocas);

  // carros estacionados nas ruas (fora do anel em volta do lote, onde passa o trânsito)
  for (let n = 0; n < 40 && carrosParadosCount() < 16; n++) {
    const vertical = rand() < 0.5;
    const centros = vertical ? ruasX : ruasZ;
    const c = centros[(rand() * centros.length) | 0];
    const lado = rand() < 0.5 ? -1 : 1;
    const ao = (rand() * 2 - 1) * (E - 4);
    const x = vertical ? c + lado * (RUA / 2 - 0.45) : ao;
    const z = vertical ? ao : c + lado * (RUA / 2 - 0.45);
    if (Math.abs(x) < cxh + RUA + 0.5 && Math.abs(z) < czh + RUA + 0.5) continue;
    if (naRua(vertical ? z : x, vertical ? ruasZ : ruasX)) continue; // não estaciona em cruzamento
    const carro = criarCarro(PINTURAS[(rand() * PINTURAS.length) | 0], 2.1, 1.3, "parado");
    carro.grupo.position.set(x, 0, z);
    carro.grupo.rotation.y = vertical ? (lado > 0 ? 0 : Math.PI) : (lado > 0 ? -Math.PI / 2 : Math.PI / 2);
    grupoCidade.add(carro.grupo);
  }

  return { E, ruasX, ruasZ };
}

function carrosParadosCount() {
  let n = 0;
  carros.forEach((c) => { if (c.tipo === "parado") n++; });
  return n;
}

/** Calçada em volta do lote, com rebaixo (acesso de veículos) onde o corredor encontra a rua. */
function calcadaCentral(cxh, czh, entradas) {
  const Wl = 2 * (cxh - CALCADA), Hl = 2 * (czh - CALCADA);
  const mat = new THREE.MeshStandardMaterial({ map: TEX_CALCADA.clone(), roughness: 0.95 });
  mat.map.repeat.set(4, 4);
  const lados = [
    { eixo: "x", fixo: -(Hl / 2 + CALCADA / 2), de: -cxh, ate: cxh, lado: "z-" },
    { eixo: "x", fixo: Hl / 2 + CALCADA / 2, de: -cxh, ate: cxh, lado: "z+" },
    { eixo: "z", fixo: -(Wl / 2 + CALCADA / 2), de: -Hl / 2, ate: Hl / 2, lado: "x-" },
    { eixo: "z", fixo: Wl / 2 + CALCADA / 2, de: -Hl / 2, ate: Hl / 2, lado: "x+" },
  ];
  for (const l of lados) {
    const cortes = entradas.filter((e) => e.lado === l.lado).map((e) => [e.pos - 1.3, e.pos + 1.3]);
    let ini = l.de;
    const trechos = [];
    for (const [a, b] of cortes.sort((p, q) => p[0] - q[0])) { if (a > ini) trechos.push([ini, a]); ini = Math.max(ini, b); }
    if (ini < l.ate) trechos.push([ini, l.ate]);
    for (const [a, b] of trechos) {
      const len = b - a, meio = (a + b) / 2;
      const m = new THREE.Mesh(l.eixo === "x" ? new THREE.BoxGeometry(len, 0.12, CALCADA) : new THREE.BoxGeometry(CALCADA, 0.12, len), mat);
      m.position.set(l.eixo === "x" ? meio : l.fixo, 0.06, l.eixo === "x" ? l.fixo : meio);
      m.receiveShadow = true;
      grupoLote.add(m);
    }
  }
}

function construir(api) {
  // descarta tudo (inclusive carros do trânsito e estacionados)
  carros.forEach((c) => carros.delete(c));
  liberar(grupoCidade); liberar(grupoLote); liberar(grupoVagas); liberar(grupoCarros);
  objetos.length = 0;
  transito.length = 0;
  for (const k of Object.keys(luzesNoite)) luzesNoite[k].length = 0;
  luzesNoite.lampadas.push(MAT_LAMPADA);

  const W = api.largura * ESCALA, H = api.altura * ESCALA;
  const Wl = W + 2 * MARGEM, Hl = H + 2 * MARGEM;
  const cxh = Wl / 2 + CALCADA, czh = Hl / 2 + CALCADA;
  const paraMundo = ([x, y]) => new THREE.Vector3(x * ESCALA - W / 2, 0, y * ESCALA - H / 2);

  // geometria de cada vaga
  const infos = api.vagas.map((v) => {
    const pts = v.pontos.map(paraMundo);
    const centro = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
    return { id: v.id, pts, centro };
  });
  const centroLote = new THREE.Vector3();
  infos.forEach((i) => centroLote.add(i.centro));
  if (infos.length) centroLote.divideScalar(infos.length);
  for (const inf of infos) {
    const e1 = inf.pts[1].clone().sub(inf.pts[0]), e2 = inf.pts[2].clone().sub(inf.pts[1]);
    const longo = e1.length() >= e2.length() ? e1 : e2;
    const curto = longo === e1 ? e2 : e1;
    const dir = longo.clone().normalize();
    inf.entrada = centroLote.clone().sub(inf.centro).dot(dir) >= 0 ? dir : dir.clone().negate();
    inf.comp = longo.length();
    inf.larg = curto.length();
    inf.corredor = inf.centro.clone().addScaledVector(inf.entrada, inf.comp * 0.5 + CORREDOR);
    let melhor = -Infinity;
    inf.pts.forEach((p, i) => {
      const meio = p.clone().add(inf.pts[(i + 1) % inf.pts.length]).multiplyScalar(0.5);
      const s = meio.sub(inf.centro).dot(inf.entrada);
      if (s > melhor) { melhor = s; inf.bordaCorredor = i; }
    });
  }

  // acessos de veículos: nas laterais para onde o corredor aponta
  const entradas = [];
  if (infos.length) {
    const lateralEmX = infos.filter((i) => Math.abs(i.entrada.z) >= Math.abs(i.entrada.x)).length >= infos.length / 2;
    const pos = infos.reduce((s, i) => s + (lateralEmX ? i.corredor.z : i.corredor.x), 0) / infos.length;
    if (lateralEmX) entradas.push({ lado: "x-", pos }, { lado: "x+", pos });
    else entradas.push({ lado: "z-", pos }, { lado: "z+", pos });
  }

  geo = { Wl, Hl, cxh, czh, entradas };
  const rand = aleatorio(Math.round(Wl * 1000 + Hl));
  construirCidade(cxh, czh, entradas, rand);

  // asfalto do lote
  const asfalto = new THREE.Mesh(
    new THREE.PlaneGeometry(Wl, Hl).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: texturaAsfalto(infos, Wl, Hl), roughness: 0.92 })
  );
  asfalto.position.y = 0.001;
  asfalto.receiveShadow = true;
  grupoLote.add(asfalto);

  // postes do lote (com refletor)
  const ex = Wl / 2 + CALCADA / 2, ez = Hl / 2 + CALCADA / 2;
  for (const [x, z] of [[-ex, -ez], [ex, -ez], [-ex, ez], [ex, ez], [0, -ez], [0, ez]]) {
    const p = criarPosteLote();
    p.position.set(x, 0.12, z);
    p.rotation.y = Math.atan2(z, -x);
    grupoLote.add(p);
  }

  // elementos de cada vaga
  const matConcreto = new THREE.MeshStandardMaterial({ color: 0xa9a59b, roughness: 0.9 });
  const matColuna = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.5, roughness: 0.4 });
  const matSensor = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6 });
  for (const inf of infos) {
    const forma = new THREE.Shape(inf.pts.map((p) => new THREE.Vector2(p.x, -p.z)));
    const matFaixa = new THREE.MeshStandardMaterial({
      color: COR.indef.clone(), transparent: true, opacity: 0.22, roughness: 0.8,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    });
    const faixa = new THREE.Mesh(new THREE.ShapeGeometry(forma).rotateX(-Math.PI / 2), matFaixa);
    faixa.position.y = 0.005;
    faixa.receiveShadow = true;
    grupoVagas.add(faixa);

    const sensor = sombra(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.03, 20), matSensor));
    sensor.position.copy(inf.centro).setY(0.016);
    const matLedSensor = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: COR.indef.clone(), emissiveIntensity: 1.2 });
    const ledSensor = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.006, 16), matLedSensor);
    ledSensor.position.copy(inf.centro).setY(0.034);
    grupoVagas.add(sensor, ledSensor);

    const base = inf.centro.clone().addScaledVector(inf.entrada, -inf.comp * 0.47);
    const coluna = sombra(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.038, 0.5, 12), matColuna));
    coluna.position.copy(base).setY(0.25);
    const matLed = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: COR.indef.clone(), emissiveIntensity: 2.2 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.052, 18, 12), matLed);
    led.position.copy(base).setY(0.54);
    const brilho = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_BRILHO, color: COR.indef.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    brilho.position.copy(led.position);
    brilho.scale.setScalar(noite ? 0.9 : 0.5);
    luzesNoite.brilhosLed.push(brilho);
    grupoVagas.add(coluna, led, brilho);

    const batente = sombra(new THREE.Mesh(new THREE.BoxGeometry(inf.larg * 0.55, 0.07, 0.1), matConcreto));
    batente.position.copy(inf.centro).addScaledVector(inf.entrada, -inf.comp * 0.36).setY(0.036);
    batente.rotation.y = Math.atan2(inf.entrada.x, inf.entrada.z);
    grupoVagas.add(batente);

    objetos.push({ ...inf, matFaixa, matLed, matLedSensor, brilho, carro: null, estado: undefined, anim: null });
  }

  criarTransito(cxh, czh);

  // sombra do sol cobrindo o lote e as quadras vizinhas
  const s = Math.max(cxh, czh) + RUA + QUADRA + 2;
  Object.assign(sol.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
  sol.shadow.camera.updateProjectionMatrix();

  const raio = Math.max(Wl, Hl);
  controles.target.set(0, 0, 0);
  camera.position.set(raio * 0.45, raio * 0.62, raio * 1.0);
  controles.update();
  aplicarTema();
}

// ---------------- Caminhos ----------------
/** Polilinha com cantos arredondados. */
function caminho(pts, raio) {
  const cp = new THREE.CurvePath();
  let atual = pts[0].clone();
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const r = Math.min(raio, a.distanceTo(b) / 2, b.distanceTo(c) / 2);
    if (r < 1e-3) continue;
    const p1 = b.clone().addScaledVector(a.clone().sub(b).normalize(), r);
    const p2 = b.clone().addScaledVector(c.clone().sub(b).normalize(), r);
    if (atual.distanceTo(p1) > 1e-3) cp.add(new THREE.LineCurve3(atual, p1));
    cp.add(new THREE.QuadraticBezierCurve3(p1, b.clone(), p2));
    atual = p2;
  }
  const fim = pts[pts.length - 1].clone();
  if (atual.distanceTo(fim) > 1e-3) cp.add(new THREE.LineCurve3(atual, fim));
  return cp;
}

const direita = (d) => new THREE.Vector3(-d.z, 0, d.x); // lado direito de quem anda na direção d

// ---------------- Trânsito em volta do quarteirão ----------------
function criarTransito(cxh, czh) {
  const rand = aleatorio(7);
  for (const [faixa, sentido, n] of [[-RUA / 4, 1, 3], [RUA / 4, -1, 3]]) {
    const hx = cxh + RUA / 2 + faixa, hz = czh + RUA / 2 + faixa;
    let cantos = [[hx, -hz], [hx, hz], [-hx, hz], [-hx, -hz]];
    if (sentido < 0) cantos = cantos.reverse();
    const v = (p) => new THREE.Vector3(p[0], 0, p[1]);
    const inicio = v(cantos[3]).add(v(cantos[0])).multiplyScalar(0.5);
    const rota = caminho([inicio, ...cantos.map(v), inicio], 1.6);
    const comprimento = rota.getLength();
    for (let i = 0; i < n; i++) {
      const carro = criarCarro(PINTURAS[(rand() * PINTURAS.length) | 0], 2.1, 1.3, "transito");
      grupoCarros.add(carro.grupo);
      transito.push({ carro, rota, comprimento, u: (i + rand() * 0.5) / n, vel: 2.2 + rand() * 0.8 });
    }
  }
}

function moverTransito(dt) {
  for (const t of transito) {
    t.u = (t.u + (t.vel * dt) / 1000 / t.comprimento) % 1;
    const pos = t.rota.getPointAt(t.u), tan = t.rota.getTangentAt(t.u);
    const ant = t.carro.grupo.position.clone();
    t.carro.grupo.position.copy(pos);
    t.carro.grupo.rotation.y = Math.atan2(tan.x, tan.z);
    const giro = pos.distanceTo(ant) / t.carro.raio;
    t.carro.rodas.forEach((r) => (r.rotation.x += giro));
  }
}

// ---------------- Manobras no estacionamento ----------------
const freando = (p) => 1 - (1 - p) * (1 - p);
const arrancando = (p) => p * p;
const suave = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/** Ponto no meio da rua, em frente ao acesso do lote, do lado para onde "lateral" aponta. */
function pontoNaRua(o, lateral) {
  if (Math.abs(lateral.x) >= Math.abs(lateral.z)) return new THREE.Vector3(Math.sign(lateral.x) * (geo.cxh + RUA / 2), 0, o.corredor.z);
  return new THREE.Vector3(o.corredor.x, 0, Math.sign(lateral.z) * (geo.czh + RUA / 2));
}

function pontosManobra(o) {
  const lado = Math.random() < 0.5 ? 1 : -1;
  const lateral = new THREE.Vector3(o.entrada.z, 0, -o.entrada.x).multiplyScalar(lado);
  const boca = o.corredor.clone().addScaledVector(lateral, o.comp * 0.9);
  return { lateral, boca };
}

/** Vem pela rua, entra no lote pelo acesso, segue no corredor e entra de frente na vaga. */
function rotaEntrada(o) {
  const { lateral, boca } = pontosManobra(o);
  const rua = pontoNaRua(o, lateral);
  const ao = new THREE.Vector3(lateral.z, 0, -lateral.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1); // direção da rua
  const faixa = direita(ao).multiplyScalar(RUA / 4); // mão direita
  const longe = rua.clone().addScaledVector(ao, -14).add(faixa);
  const curvaRua = rua.clone().add(faixa);
  const trecho = caminho([longe, curvaRua, boca], 1.6);
  return [
    { curva: trecho, dur: (trecho.getLength() / VELOCIDADE) * 1000, re: false, ritmo: (p) => p },
    { curva: new THREE.QuadraticBezierCurve3(boca, o.corredor.clone(), o.centro.clone()), dur: 2200, re: false, ritmo: freando },
  ];
}

/** Sai de ré até o corredor, vai até o acesso e segue pela rua. */
function rotaSaida(o) {
  const { lateral, boca } = pontosManobra(o);
  const rua = pontoNaRua(o, lateral.clone().negate());
  const ao = new THREE.Vector3(lateral.z, 0, -lateral.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
  const faixa = direita(ao).multiplyScalar(RUA / 4);
  const trecho = caminho([boca, rua.clone().add(faixa), rua.clone().add(faixa).addScaledVector(ao, 14)], 1.6);
  return [
    { curva: new THREE.QuadraticBezierCurve3(o.centro.clone(), o.corredor.clone(), boca), dur: 2400, re: true, ritmo: suave },
    { curva: trecho, dur: (trecho.getLength() / VELOCIDADE) * 1000, re: false, ritmo: arrancando },
  ];
}

function posicionar(carro, fase, p) {
  const pos = fase.curva.getPointAt(Math.min(1, Math.max(0, p)));
  const tan = fase.curva.getTangentAt(Math.min(1, Math.max(0, p)));
  if (fase.re) tan.negate();
  carro.grupo.position.copy(pos);
  carro.grupo.rotation.y = Math.atan2(tan.x, tan.z);
}

function estacionar(o, cor, animar, t) {
  if (o.anim && o.anim.aoFim) o.anim.aoFim();
  if (o.carro) removerCarro(o.carro);
  const carro = criarCarro(cor, o.comp, o.larg, "lote");
  grupoCarros.add(carro.grupo);
  o.carro = carro;
  if (animar) {
    const fases = rotaEntrada(o);
    posicionar(carro, fases[0], 0);
    carro.movendo = true;
    luzesCarro(carro);
    o.anim = { carro, fases, t0: t, ultimo: carro.grupo.position.clone(), aoFim: null };
  } else {
    carro.grupo.position.copy(o.centro);
    carro.grupo.rotation.y = Math.atan2(-o.entrada.x, -o.entrada.z);
    o.anim = null;
  }
}

function sair(o, t) {
  if (!o.carro) return;
  const carro = o.carro;
  o.carro = null;
  carro.movendo = true;
  luzesCarro(carro);
  o.anim = { carro, fases: rotaSaida(o), t0: t, ultimo: carro.grupo.position.clone(), aoFim: () => removerCarro(carro) };
}

function animar(o, t) {
  const a = o.anim;
  let decorrido = t - a.t0;
  let fase = null, p = 1, indice = 0;
  for (const [i, f] of a.fases.entries()) {
    if (decorrido <= f.dur) { fase = f; p = f.ritmo(Math.max(0, decorrido / f.dur)); indice = i; break; }
    decorrido -= f.dur;
  }
  const terminou = !fase;
  if (terminou) { fase = a.fases[a.fases.length - 1]; indice = a.fases.length - 1; }
  posicionar(a.carro, fase, p);

  const pos = a.carro.grupo.position;
  const giro = (pos.distanceTo(a.ultimo) / a.carro.raio) * (fase.re ? -1 : 1);
  a.carro.rodas.forEach((r) => (r.rotation.x += giro));
  a.ultimo.copy(pos);
  // freio: na ré e na chegada à vaga
  const freio = !terminou && (fase.re || (a.aoFim === null && indice === a.fases.length - 1));
  if (freio !== a.carro.freio) { a.carro.freio = freio; luzesCarro(a.carro); }

  if (terminou) {
    o.anim = null;
    a.carro.movendo = false;
    a.carro.freio = false;
    luzesCarro(a.carro);
    if (a.aoFim) a.aoFim();
  }
}

// ---------------- Dia / noite ----------------
function aplicarTema() {
  renderer.toneMappingExposure = noite ? 1.0 : 0.62;
  ceuDia.visible = !noite;
  ceuNoite.visible = noite;
  cena.environment = noite ? envNoite : envDia;
  cena.fog.color.set(noite ? 0x0a0f1d : 0xc9d6e3);
  cena.fog.near = noite ? 30 : 45;
  cena.fog.far = noite ? 120 : 150;

  hemi.color.set(noite ? 0x3a4a78 : 0xdfe9f5);
  hemi.groundColor.set(noite ? 0x0a0a0c : 0x3b4a2f);
  hemi.intensity = noite ? 0.3 : 0.35;
  sol.color.set(noite ? 0x9fb3e0 : 0xfff1dc);
  sol.intensity = noite ? 0.35 : 3.0;
  sol.position.copy(noite ? DIR_LUA : DIR_SOL).multiplyScalar(40);

  luzesNoite.janelas.forEach((m) => (m.emissiveIntensity = noite ? 1.1 : 0));
  luzesNoite.lampadas.forEach((m) => (m.emissiveIntensity = noite ? 4 : 0.15));
  luzesNoite.pocas.forEach((p) => (p.visible = noite));
  luzesNoite.refletores.forEach((l) => (l.visible = noite));
  luzesNoite.brilhosLed.forEach((s) => s.scale.setScalar(noite ? 0.9 : 0.5));
  carros.forEach(luzesCarro);
}

window.addEventListener("tema", (e) => { noite = !!e.detail.noite; aplicarTema(); });

// ---------------- Atualização por quadro ----------------
function atualizar(api, t) {
  api.estados.forEach((e, i) => {
    const o = objetos[i];
    if (!o) return;
    if (e.ocupada !== o.estado) {
      const primeiro = o.estado === undefined || o.estado === null;
      if (e.ocupada === true) {
        const rgb = window.estacionamento.corDoCarro(o.id);
        const cor = rgb ? new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace) : hashCor(o.id);
        estacionar(o, cor, !primeiro, t);
      } else if (e.ocupada === false) {
        sair(o, t);
      }
      o.estado = e.ocupada;
    }
    const alvo = e.ocupada === true ? COR.ocupada : e.ocupada === false ? COR.livre : COR.indef;
    o.matFaixa.color.lerp(alvo, 0.08);
    o.matLed.emissive.lerp(alvo, 0.15);
    o.matLedSensor.emissive.lerp(alvo, 0.15);
    o.brilho.material.color.lerp(alvo, 0.15);
    if (o.anim) animar(o, t);
  });
}

function redimensionar() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(redimensionar).observe(host);

let tAnterior = null;
function quadro() {
  requestAnimationFrame(quadro);
  const api = window.estacionamento && window.estacionamento.estado();
  if (!api) return;
  const t = window.estacionamento.tempo ? window.estacionamento.tempo() : performance.now();
  const dt = tAnterior === null ? 0 : Math.min(100, Math.max(0, t - tAnterior));
  tAnterior = t;

  const tamanho = `${api.largura}x${api.altura}`;
  if (api.estados !== refEstados || tamanho !== refTamanho) {
    construir(api);
    refEstados = api.estados;
    refTamanho = tamanho;
  }
  atualizar(api, t);
  moverTransito(dt);

  const livres = api.estados.filter((e) => e.ocupada === false).length;
  document.getElementById("placar3d").textContent = `${livres} / ${api.vagas.length}`;
  document.getElementById("pausa3d").hidden = !api.pausado;
  controles.autoRotate = girarSozinho && !api.pausado;

  if (host.offsetParent === null) return;
  controles.update();
  renderer.render(cena, camera);
}
aplicarTema();
redimensionar();
quadro();
