/* Vista 3D realista do estacionamento.
 * Lê o estado da detecção exposto por app.js (window.estacionamento) e o representa em 3D:
 * asfalto pintado, sensor + luz indicadora em cada vaga e carros que manobram para entrar e sair.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";

const ESCALA = 1 / 100;   // 100 px da imagem = 1 unidade 3D
const MARGEM = 0.8;       // asfalto além das vagas
const CORREDOR = 1.0;     // distância da boca da vaga até o meio do corredor
const COR = {
  livre: new THREE.Color(0x22c55e),
  ocupada: new THREE.Color(0xef4444),
  indef: new THREE.Color(0x9ca3af),
};
const PINTURAS = [0xf1f1ee, 0xb9bdc3, 0x17191d, 0x4b5058, 0x8e1b1b, 0x1d3866, 0x2f4b3b, 0x6c7076];

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
renderer.toneMappingExposure = 0.62;
host.appendChild(renderer.domElement);
const ANISO = renderer.capabilities.getMaxAnisotropy();

// ---------------- Cena, câmera e controles ----------------
const cena = new THREE.Scene();
cena.fog = new THREE.Fog(0xc9d6e3, 40, 120);

const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 1000);
const controles = new OrbitControls(camera, renderer.domElement);
controles.enableDamping = true;
controles.dampingFactor = 0.08;
controles.maxPolarAngle = Math.PI / 2.12;
controles.minDistance = 2;
controles.maxDistance = 40;
controles.autoRotateSpeed = 0.3;
let girarSozinho = true;
controles.addEventListener("start", () => (girarSozinho = false));

// ---------------- Céu, sol e iluminação ----------------
const DIR_SOL = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(135));

function criarCeu(escala) {
  const ceu = new Sky();
  ceu.scale.setScalar(escala);
  const u = ceu.material.uniforms;
  u.turbidity.value = 5;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(DIR_SOL);
  return ceu;
}
cena.add(criarCeu(500));
{ // reflexos do céu em todos os materiais
  const pmrem = new THREE.PMREMGenerator(renderer);
  const cenaCeu = new THREE.Scene();
  cenaCeu.add(criarCeu(50));
  cena.environment = pmrem.fromScene(cenaCeu, 0.02).texture;
  pmrem.dispose();
}

cena.add(new THREE.HemisphereLight(0xdfe9f5, 0x3b4a2f, 0.35));
const sol = new THREE.DirectionalLight(0xfff1dc, 3.0);
sol.position.copy(DIR_SOL).multiplyScalar(30);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
sol.shadow.bias = -0.0003;
sol.shadow.normalBias = 0.02;
sol.shadow.camera.far = 90;
cena.add(sol, sol.target);

// ---------------- Texturas procedurais ----------------
function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")];
}

function texturaGrama() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#4d6b35"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? "rgba(30,50,20,.35)" : v < 0.85 ? "rgba(110,140,70,.35)" : "rgba(150,150,90,.3)";
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(90, 90);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  return t;
}

let _texSombra = null;
function texturaSombra() {
  if (_texSombra) return _texSombra;
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, "rgba(0,0,0,.85)");
  gr.addColorStop(0.6, "rgba(0,0,0,.35)");
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return (_texSombra = new THREE.CanvasTexture(c));
}

let _texBrilho = null;
function texturaBrilho() {
  if (_texBrilho) return _texBrilho;
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.25, "rgba(255,255,255,.55)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (_texBrilho = new THREE.CanvasTexture(c));
}

/** Asfalto com granulado, manchas, rachaduras, faixas pintadas e números das vagas. */
function texturaAsfalto(infos, Wl, Hl) {
  const k = 2048 / Math.max(Wl, Hl); // px de textura por unidade
  const [c, g] = canvas(Math.round(Wl * k), Math.round(Hl * k));
  const P = (v) => [(v.x + Wl / 2) * k, (v.z + Hl / 2) * k];

  g.fillStyle = "#4a4d52"; g.fillRect(0, 0, c.width, c.height);
  const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(im, 0, 0);

  for (let i = 0; i < 18; i++) { // desgaste
    const x = Math.random() * c.width, y = Math.random() * c.height, r = (0.6 + Math.random() * 2.2) * k;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, Math.random() < 0.6 ? "rgba(0,0,0,.10)" : "rgba(255,255,255,.05)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.strokeStyle = "rgba(20,20,22,.55)"; g.lineWidth = Math.max(1, 0.012 * k);
  for (let i = 0; i < 12; i++) { // rachaduras
    let x = Math.random() * c.width, y = Math.random() * c.height;
    g.beginPath(); g.moveTo(x, y);
    for (let j = 0; j < 10; j++) { x += (Math.random() - 0.5) * 0.35 * k; y += (Math.random() - 0.5) * 0.35 * k; g.lineTo(x, y); }
    g.stroke();
  }

  for (const inf of infos) {
    // mancha de óleo sob o motor (frente do carro fica para dentro da vaga)
    const [ox, oy] = P(inf.centro.clone().addScaledVector(inf.entrada, -inf.comp * 0.22));
    const ro = inf.larg * 0.28 * k;
    const gr = g.createRadialGradient(ox, oy, 0, ox, oy, ro);
    gr.addColorStop(0, "rgba(12,12,14,.45)"); gr.addColorStop(1, "rgba(12,12,14,0)");
    g.fillStyle = gr; g.fillRect(ox - ro, oy - ro, 2 * ro, 2 * ro);

    // faixas brancas (todas as bordas menos a do corredor)
    g.strokeStyle = "rgba(236,236,226,.9)"; g.lineWidth = 0.07 * k; g.lineCap = "square";
    const n = inf.pts.length;
    for (let i = 0; i < n; i++) {
      if (i === inf.bordaCorredor) continue;
      const [x0, y0] = P(inf.pts[i]), [x1, y1] = P(inf.pts[(i + 1) % n]);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }

    // número pintado na boca da vaga, legível de quem chega pelo corredor
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

// ---------------- Utilidades ----------------
function liberar(grupo) {
  grupo.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (m.map && m.map !== _texSombra && m.map !== _texBrilho) m.map.dispose();
      m.dispose();
    });
  });
  grupo.clear();
}

function aleatorio(semente) { // mulberry32: entorno igual a cada reconstrução
  return () => {
    semente |= 0; semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PINTURAS[Math.abs(h) % PINTURAS.length];
}

const sombra = (m, recebe = true) => { m.castShadow = true; m.receiveShadow = recebe; return m; };

// ---------------- Carro ----------------
/** Perfil lateral (z = comprimento, y = altura) com caixas de roda. */
function perfilCarroceria(L, y0, hb, r, zRoda, ra) {
  const s = new THREE.Shape();
  s.moveTo(-0.5 * L, y0 + 0.12 * hb);
  s.lineTo(-0.47 * L, y0);
  const phi = Math.asin(Math.min(1, (r - y0) / ra));
  const dx = Math.sqrt(Math.max(0, ra * ra - (r - y0) ** 2));
  for (const zc of [-zRoda, zRoda]) {
    s.lineTo(zc - dx, y0);
    s.absarc(zc, r, ra, Math.PI + phi, -phi, true); // arco por cima da roda
  }
  s.lineTo(0.47 * L, y0);
  for (const [z, y] of [[0.5, 0.15], [0.5, 0.6], [0.46, 0.86], [0.18, 1], [-0.3, 1], [-0.47, 0.9], [-0.5, 0.6]]) {
    s.lineTo(z * L, y0 + y * hb);
  }
  s.closePath();
  return s;
}

function perfilCabine(L, base, c) {
  const s = new THREE.Shape();
  [[0.17, 0], [0.0, 1], [-0.23, 1], [-0.38, 0]].forEach(([z, y], i) =>
    i ? s.lineTo(z * L, base + y * c) : s.moveTo(z * L, base + y * c));
  s.closePath();
  return s;
}

/** Extruda um perfil lateral na largura do carro (eixo X), centrado. */
function extrudarLargura(perfil, largura, bisel) {
  const prof = Math.max(0.01, largura - 2 * bisel);
  const g = new THREE.ExtrudeGeometry(perfil, {
    depth: prof, bevelEnabled: true, bevelThickness: bisel, bevelSize: bisel, bevelSegments: 3, curveSegments: 10,
  });
  g.rotateY(-Math.PI / 2);   // perfil (x,y) -> (z,y); extrusão -> -x
  g.translate(prof / 2, 0, 0);
  return g;
}

function criarCarro(cor, comp, larg) {
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
  const farol = new THREE.MeshStandardMaterial({ color: 0xf5f3ea, emissive: 0xfff3d6, emissiveIntensity: 0.5, roughness: 0.1 });
  const lanterna = new THREE.MeshStandardMaterial({ color: 0x5b0b0b, emissive: 0xff2a2a, emissiveIntensity: 0.4, roughness: 0.2 });
  const placa = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.5 });

  grupo.add(sombra(new THREE.Mesh(extrudarLargura(perfilCarroceria(L, y0, hb, r, zRoda, r * 1.12), W, bisel), pintura)));
  grupo.add(sombra(new THREE.Mesh(extrudarLargura(perfilCabine(L, y0 + hb, c), W * 0.84, 0.025), vidro)));

  const teto = sombra(new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.018, L * 0.2), pintura));
  teto.position.set(0, y0 + hb + c + 0.03, -0.115 * L);
  grupo.add(teto);

  // rodas (pneu + aro), giram em torno do eixo X
  const rodas = [];
  const larguraPneu = W * 0.2;
  const geoPneu = new THREE.CylinderGeometry(r, r, larguraPneu, 28).rotateZ(Math.PI / 2);
  const geoAro = new THREE.CylinderGeometry(r * 0.62, r * 0.62, larguraPneu * 1.04, 6).rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const roda = new THREE.Group();
    roda.add(sombra(new THREE.Mesh(geoPneu, pneu)), new THREE.Mesh(geoAro, aro));
    roda.position.set(sx * (W / 2 + bisel - larguraPneu / 2 - 0.004), r, sz * zRoda);
    grupo.add(roda);
    rodas.push(roda);
  }

  // faróis, lanternas, grade, placas e retrovisores
  const frente = 0.5 * L + bisel + 0.004;
  const geoLuz = new THREE.BoxGeometry(W * 0.22, hb * 0.14, 0.02);
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(geoLuz, farol); f.position.set(sx * W * 0.31, y0 + hb * 0.62, frente); grupo.add(f);
    const t = new THREE.Mesh(geoLuz, lanterna); t.position.set(sx * W * 0.31, y0 + hb * 0.66, -frente); grupo.add(t);
    const esp = sombra(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.03), pintura));
    esp.position.set(sx * (W / 2 + bisel + 0.025), y0 + hb + 0.02, 0.15 * L); grupo.add(esp);
  }
  const grade = new THREE.Mesh(new THREE.BoxGeometry(W * 0.36, hb * 0.16, 0.02), plastico);
  grade.position.set(0, y0 + hb * 0.4, frente); grupo.add(grade);
  for (const z of [frente + 0.002, -frente - 0.002]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(W * 0.24, hb * 0.13, 0.01), placa);
    p.position.set(0, y0 + hb * 0.25, z); grupo.add(p);
  }

  // sombra de contato (escurece o chão sob o carro)
  const contato = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.35, L * 1.1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: texturaSombra(), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false })
  );
  contato.position.y = 0.007;
  grupo.add(contato);

  return { grupo, rodas, lanterna, raio: r };
}

// ---------------- Entorno ----------------
const grama = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ map: texturaGrama(), roughness: 1 })
);
grama.position.y = -0.02;
grama.receiveShadow = true;
cena.add(grama);

function criarArvore(rand) {
  const g = new THREE.Group();
  const tronco = sombra(new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.09, 1.0, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 })
  ));
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

function criarPoste() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3f454d, metalness: 0.7, roughness: 0.35 });
  const haste = sombra(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 3.2, 12), metal));
  haste.position.y = 1.6;
  const braco = sombra(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.045, 0.06), metal));
  braco.position.set(0.33, 3.15, 0);
  const cabeca = sombra(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.2), metal));
  cabeca.position.set(0.62, 3.12, 0);
  const lente = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.01, 0.15),
    new THREE.MeshStandardMaterial({ color: 0xf4f1e6, emissive: 0xfff4d8, emissiveIntensity: 0.25 }));
  lente.position.set(0.62, 3.08, 0);
  g.add(haste, braco, cabeca, lente);
  return g;
}

// ---------------- Construção a partir das vagas ----------------
const grupoLote = new THREE.Group();
const grupoVagas = new THREE.Group();
const grupoCarros = new THREE.Group();
cena.add(grupoLote, grupoVagas, grupoCarros);

const objetos = [];
let refEstados = null;
let refTamanho = "";

function construir(api) {
  liberar(grupoLote); liberar(grupoVagas); liberar(grupoCarros);
  objetos.length = 0;

  const W = api.largura * ESCALA, H = api.altura * ESCALA;
  const Wl = W + 2 * MARGEM, Hl = H + 2 * MARGEM;
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
    // a boca da vaga aponta para o centro do estacionamento (onde fica o corredor)
    inf.entrada = centroLote.clone().sub(inf.centro).dot(dir) >= 0 ? dir : dir.clone().negate();
    inf.comp = longo.length();
    inf.larg = curto.length();
    let melhor = -Infinity;
    inf.pts.forEach((p, i) => {
      const meio = p.clone().add(inf.pts[(i + 1) % inf.pts.length]).multiplyScalar(0.5);
      const s = meio.sub(inf.centro).dot(inf.entrada);
      if (s > melhor) { melhor = s; inf.bordaCorredor = i; }
    });
  }

  // asfalto pintado
  const asfalto = new THREE.Mesh(
    new THREE.PlaneGeometry(Wl, Hl).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: texturaAsfalto(infos, Wl, Hl), roughness: 0.92 })
  );
  asfalto.receiveShadow = true;
  grupoLote.add(asfalto);

  // calçada
  const concreto = new THREE.MeshStandardMaterial({ color: 0xb8b5ac, roughness: 0.95 });
  const LC = 0.9;
  for (const [w, d, x, z] of [
    [Wl + 2 * LC, LC, 0, -(Hl / 2 + LC / 2)], [Wl + 2 * LC, LC, 0, Hl / 2 + LC / 2],
    [LC, Hl, -(Wl / 2 + LC / 2), 0], [LC, Hl, Wl / 2 + LC / 2, 0],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), concreto);
    m.position.set(x, 0.06 - 0.001, z);
    m.receiveShadow = true;
    grupoLote.add(m);
  }

  // postes na calçada e árvores no gramado
  const rand = aleatorio(Math.round(Wl * 1000 + Hl));
  const ex = Wl / 2 + LC / 2, ez = Hl / 2 + LC / 2;
  const postes = [[-ex, -ez], [ex, -ez], [-ex, ez], [ex, ez], [0, -ez], [0, ez]];
  for (const [x, z] of postes) {
    const p = criarPoste();
    p.position.set(x, 0.12, z);
    p.rotation.y = Math.atan2(z, -x); // braço voltado para o lote
    grupoLote.add(p);
  }
  const ax = Wl / 2 + LC + 1.0, az = Hl / 2 + LC + 1.0;
  const passo = 2.3;
  const borda = [];
  for (let x = -ax; x <= ax; x += passo) borda.push([x, -az], [x, az]);
  for (let z = -az + passo; z < az; z += passo) borda.push([-ax, z], [ax, z]);
  for (const [x, z] of borda) {
    if (rand() < 0.2) continue;
    const a = criarArvore(rand);
    a.position.set(x + (rand() - 0.5) * 0.6, 0, z + (rand() - 0.5) * 0.6);
    grupoLote.add(a);
  }

  // elementos de cada vaga: faixa de status, sensor, coluna indicadora e batente
  const matConcreto = new THREE.MeshStandardMaterial({ color: 0xa9a59b, roughness: 0.9 });
  const matColuna = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.5, roughness: 0.4 });
  const matSensor = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6 });
  for (const inf of infos) {
    const angulo = Math.atan2(inf.entrada.x, inf.entrada.z);

    const forma = new THREE.Shape(inf.pts.map((p) => new THREE.Vector2(p.x, -p.z)));
    const matFaixa = new THREE.MeshStandardMaterial({
      color: COR.indef.clone(), transparent: true, opacity: 0.22, roughness: 0.8,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    });
    const faixa = new THREE.Mesh(new THREE.ShapeGeometry(forma).rotateX(-Math.PI / 2), matFaixa);
    faixa.position.y = 0.004;
    faixa.receiveShadow = true;
    grupoVagas.add(faixa);

    // sensor no piso (o mesmo SNS-xx da aba "Funcionamento do sistema")
    const sensor = sombra(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.03, 20), matSensor));
    sensor.position.copy(inf.centro).setY(0.015);
    const matLedSensor = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: COR.indef.clone(), emissiveIntensity: 1.2 });
    const ledSensor = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.006, 16), matLedSensor);
    ledSensor.position.copy(inf.centro).setY(0.033);
    grupoVagas.add(sensor, ledSensor);

    // coluna com luz indicadora no fundo da vaga
    const base = inf.centro.clone().addScaledVector(inf.entrada, -inf.comp * 0.47);
    const coluna = sombra(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.038, 0.5, 12), matColuna));
    coluna.position.copy(base).setY(0.25);
    const matLed = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: COR.indef.clone(), emissiveIntensity: 2.2 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.052, 18, 12), matLed);
    led.position.copy(base).setY(0.54);
    const brilho = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texturaBrilho(), color: COR.indef.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    brilho.position.copy(led.position);
    brilho.scale.setScalar(0.5);
    grupoVagas.add(coluna, led, brilho);

    // batente de concreto
    const batente = sombra(new THREE.Mesh(new THREE.BoxGeometry(inf.larg * 0.55, 0.07, 0.1), matConcreto));
    batente.position.copy(inf.centro).addScaledVector(inf.entrada, -inf.comp * 0.36).setY(0.035);
    batente.rotation.y = angulo;
    grupoVagas.add(batente);

    objetos.push({
      ...inf, matFaixa, matLed, matLedSensor, brilho,
      carro: null, estado: undefined, anim: null,
    });
  }

  // sombra do sol cobrindo o lote e o entorno
  const s = Math.max(Wl, Hl) / 2 + 4;
  Object.assign(sol.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
  sol.shadow.camera.updateProjectionMatrix();

  const raio = Math.max(Wl, Hl);
  controles.target.set(0, 0, 0);
  camera.position.set(raio * 0.32, raio * 0.5, raio * 0.78);
  controles.update();
}

// ---------------- Manobras ----------------
const linear = (p) => p;
const freando = (p) => 1 - (1 - p) * (1 - p);
const arrancando = (p) => p * p;
const suave = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

function pontosCorredor(o, lado) {
  const lateral = new THREE.Vector3(o.entrada.z, 0, -o.entrada.x).multiplyScalar(lado);
  const corredor = o.centro.clone().addScaledVector(o.entrada, o.comp * 0.5 + CORREDOR);
  return { lateral, corredor, curva: corredor.clone().addScaledVector(lateral, o.comp * 0.9) };
}

/** Chega pelo corredor e entra de frente na vaga. */
function rotaEntrada(o) {
  const { lateral, corredor, curva } = pontosCorredor(o, Math.random() < 0.5 ? 1 : -1);
  const longe = curva.clone().addScaledVector(lateral, 7);
  return [
    { curva: new THREE.LineCurve3(longe, curva), dur: 2200, re: false, ritmo: linear },
    { curva: new THREE.QuadraticBezierCurve3(curva, corredor, o.centro.clone()), dur: 2200, re: false, ritmo: freando },
  ];
}

/** Sai de ré até o corredor e segue em frente. */
function rotaSaida(o) {
  const { lateral, corredor, curva } = pontosCorredor(o, Math.random() < 0.5 ? 1 : -1);
  return [
    { curva: new THREE.QuadraticBezierCurve3(o.centro.clone(), corredor, curva), dur: 2400, re: true, ritmo: suave },
    { curva: new THREE.LineCurve3(curva, curva.clone().addScaledVector(lateral, -8)), dur: 2600, re: false, ritmo: arrancando },
  ];
}

function posicionar(carro, fase, p) {
  const pos = fase.curva.getPointAt(p);
  const tan = fase.curva.getTangentAt(p);
  if (fase.re) tan.negate(); // de ré: a frente aponta contra o movimento
  carro.grupo.position.copy(pos);
  carro.grupo.rotation.y = Math.atan2(tan.x, tan.z);
}

function removerCarro(carro) {
  grupoCarros.remove(carro.grupo);
  liberar(carro.grupo);
}

function estacionar(o, cor, animar, t) {
  if (o.anim && o.anim.aoFim) o.anim.aoFim(); // carro anterior ainda saindo: remove
  if (o.carro) removerCarro(o.carro);
  const carro = criarCarro(cor, o.comp, o.larg);
  grupoCarros.add(carro.grupo);
  o.carro = carro;
  if (animar) {
    const fases = rotaEntrada(o);
    posicionar(carro, fases[0], 0);
    o.anim = { carro, fases, t0: t, ultimo: carro.grupo.position.clone(), aoFim: null };
  } else {
    carro.grupo.position.copy(o.centro);
    carro.grupo.rotation.y = Math.atan2(-o.entrada.x, -o.entrada.z); // frente para dentro da vaga
    o.anim = null;
  }
}

function sair(o, t) {
  if (!o.carro) return;
  const carro = o.carro;
  o.carro = null;
  o.anim = { carro, fases: rotaSaida(o), t0: t, ultimo: carro.grupo.position.clone(), aoFim: () => removerCarro(carro) };
}

function animar(o, t) {
  const a = o.anim;
  let decorrido = t - a.t0;
  let fase = null, p = 1;
  for (const f of a.fases) {
    if (decorrido <= f.dur) { fase = f; p = f.ritmo(Math.max(0, decorrido / f.dur)); break; }
    decorrido -= f.dur;
  }
  const terminou = !fase;
  if (terminou) fase = a.fases[a.fases.length - 1];
  posicionar(a.carro, fase, p);

  // rodas giram conforme a distância percorrida; luz de freio acesa durante a manobra
  const pos = a.carro.grupo.position;
  const giro = (pos.distanceTo(a.ultimo) / a.carro.raio) * (fase.re ? -1 : 1);
  a.carro.rodas.forEach((r) => (r.rotation.x += giro));
  a.ultimo.copy(pos);
  a.carro.lanterna.emissiveIntensity = terminou ? 0.4 : 2.2;

  if (terminou) {
    o.anim = null;
    if (a.aoFim) a.aoFim();
  }
}

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

// ---------------- Laço ----------------
function redimensionar() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(redimensionar).observe(host);

function quadro() {
  requestAnimationFrame(quadro);
  const api = window.estacionamento && window.estacionamento.estado();
  if (!api) return;
  const t = window.estacionamento.tempo ? window.estacionamento.tempo() : performance.now();

  const tamanho = `${api.largura}x${api.altura}`;
  if (api.estados !== refEstados || tamanho !== refTamanho) {
    construir(api);
    refEstados = api.estados;
    refTamanho = tamanho;
  }
  atualizar(api, t);

  const livres = api.estados.filter((e) => e.ocupada === false).length;
  document.getElementById("placar3d").textContent = `${livres} / ${api.vagas.length}`;
  document.getElementById("pausa3d").hidden = !api.pausado;
  controles.autoRotate = girarSozinho && !api.pausado;

  if (host.offsetParent === null) return; // aba oculta: não renderiza
  controles.update();
  renderer.render(cena, camera);
}
redimensionar();
quadro();
