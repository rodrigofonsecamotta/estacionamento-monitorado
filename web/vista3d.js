/* Vista 3D do estacionamento (gêmeo digital).
 * Lê o estado da detecção exposto por app.js (window.estacionamento) e o representa em 3D:
 * vagas como pisos coloridos e carros que entram/saem com animação.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const ESCALA = 1 / 100; // 100 px da imagem = 1 unidade 3D
const COR_LIVRE = new THREE.Color(0x22c55e);
const COR_OCUPADA = new THREE.Color(0xef4444);
const COR_INDEF = new THREE.Color(0x9ca3af);
const PALETA = [0xb42828, 0x1e3cb4, 0x1e1e1e, 0xd0d0d0, 0x288c28, 0xdca014, 0x7c3aed, 0x0ea5e9];
const DURACAO_ANIM = 1600;

const host = document.getElementById("vista3d");
const erro = document.getElementById("erro3d");

function falhar(msg) {
  erro.textContent = msg;
  erro.hidden = false;
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (e) {
  falhar("Seu navegador não suporta WebGL; a vista 3D não está disponível. Use a aba “Câmera + detecção”.");
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.appendChild(renderer.domElement);

// ---------------- Cena ----------------
const cena = new THREE.Scene();
cena.background = new THREE.Color(0x0b1220);
cena.fog = new THREE.Fog(0x0b1220, 22, 55);

const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
camera.position.set(0, 10, 12);

const controles = new OrbitControls(camera, renderer.domElement);
controles.enableDamping = true;
controles.dampingFactor = 0.08;
controles.maxPolarAngle = Math.PI / 2.2;
controles.minDistance = 3;
controles.maxDistance = 35;
controles.autoRotate = true;
controles.autoRotateSpeed = 0.35;
controles.addEventListener("start", () => (controles.autoRotate = false));

cena.add(new THREE.HemisphereLight(0xbcd4ff, 0x20242c, 0.9));
const sol = new THREE.DirectionalLight(0xfff4e0, 2.2);
sol.position.set(7, 14, 6);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
sol.shadow.camera.left = sol.shadow.camera.bottom = -14;
sol.shadow.camera.right = sol.shadow.camera.top = 14;
sol.shadow.bias = -0.0005;
cena.add(sol);

const chao = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: 0x151a22, roughness: 1 })
);
chao.rotation.x = -Math.PI / 2;
chao.position.y = -0.02;
chao.receiveShadow = true;
cena.add(chao);

const grupoLote = new THREE.Group(); // piso do estacionamento, meio-fio e postes
const grupoVagas = new THREE.Group();
cena.add(grupoLote, grupoVagas);

// ---------------- Utilidades ----------------
function liberar(grupo) {
  grupo.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (m.map) m.map.dispose();
      m.dispose();
    });
  });
  grupo.clear();
}

function hashCor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETA[Math.abs(h) % PALETA.length];
}

function etiqueta(texto) {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(15,23,42,.85)";
  g.beginPath(); g.roundRect(4, 8, 120, 48, 14); g.fill();
  g.fillStyle = "#fff";
  g.font = "bold 30px system-ui, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(texto, 64, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(0.7, 0.35, 1);
  return s;
}

function sombra(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Carro low-poly com a frente apontando para +Z local. */
function criarCarro(cor, comprimentoVaga, larguraVaga) {
  const L = Math.min(comprimentoVaga * 0.8, 2.2);
  const W = Math.min(larguraVaga * 0.72, L * 0.5);
  const H = W * 0.36;
  const r = W * 0.17;
  const g = new THREE.Group();

  const pintura = new THREE.MeshStandardMaterial({ color: cor, metalness: 0.55, roughness: 0.35 });
  const vidro = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.3, roughness: 0.08 });
  const borracha = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

  const corpo = sombra(new THREE.Mesh(new RoundedBoxGeometry(W, H, L, 3, H * 0.3), pintura));
  corpo.position.y = r + H / 2;
  g.add(corpo);

  const cabine = sombra(new THREE.Mesh(new RoundedBoxGeometry(W * 0.84, H * 0.85, L * 0.48, 3, H * 0.25), vidro));
  cabine.position.set(0, r + H + H * 0.38, -L * 0.04);
  g.add(cabine);

  const teto = sombra(new THREE.Mesh(new RoundedBoxGeometry(W * 0.8, H * 0.12, L * 0.36, 2, H * 0.05), pintura));
  teto.position.set(0, r + H + H * 0.82, -L * 0.04);
  g.add(teto);

  const rodaGeo = new THREE.CylinderGeometry(r, r, W * 0.16, 18).rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const roda = sombra(new THREE.Mesh(rodaGeo, borracha));
    roda.position.set(sx * (W / 2 - W * 0.06), r, sz * L * 0.32);
    g.add(roda);
  }

  const farol = new THREE.MeshStandardMaterial({ color: 0xfff7d6, emissive: 0xfff1b8, emissiveIntensity: 1.4 });
  const lanterna = new THREE.MeshStandardMaterial({ color: 0x7f1d1d, emissive: 0xef4444, emissiveIntensity: 1.2 });
  const luzGeo = new THREE.BoxGeometry(W * 0.2, H * 0.22, 0.03);
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(luzGeo, farol);
    f.position.set(sx * W * 0.3, r + H * 0.6, L / 2 + 0.005);
    const t = new THREE.Mesh(luzGeo, lanterna);
    t.position.set(sx * W * 0.3, r + H * 0.6, -L / 2 - 0.005);
    g.add(f, t);
  }
  return g;
}

function criarPoste(x, z) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.4 });
  const haste = sombra(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3, 10), metal));
  haste.position.y = 1.5;
  const braco = sombra(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.08), metal));
  braco.position.set(0.28, 3, 0);
  const lampada = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.06, 0.18),
    new THREE.MeshStandardMaterial({ color: 0xfff7d6, emissive: 0xffe9a8, emissiveIntensity: 2 })
  );
  lampada.position.set(0.5, 2.96, 0);
  const luz = new THREE.PointLight(0xffe2a8, 6, 7, 2);
  luz.position.set(0.5, 2.8, 0);
  g.add(haste, braco, lampada, luz);
  g.position.set(x, 0, z);
  return g;
}

// ---------------- Construção da cena a partir das vagas ----------------
const objetos = []; // por vaga: { piso, centro, entrada, comp, larg, carro, estado, anim }
let refEstados = null;
let refTamanho = "";

function construir(api) {
  liberar(grupoLote);
  liberar(grupoVagas);
  objetos.length = 0;

  const W = api.largura * ESCALA, H = api.altura * ESCALA;
  const loteMat = new THREE.MeshStandardMaterial({ color: 0x2b313b, roughness: 0.95 });
  const lote = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.06, H + 0.6), loteMat);
  lote.position.y = 0.0;
  lote.receiveShadow = true;
  grupoLote.add(lote);

  const meioFio = new THREE.MeshStandardMaterial({ color: 0x9aa3af, roughness: 0.8 });
  for (const [w, d, x, z] of [
    [W + 0.8, 0.1, 0, -(H / 2 + 0.35)], [W + 0.8, 0.1, 0, H / 2 + 0.35],
    [0.1, H + 0.8, -(W / 2 + 0.35), 0], [0.1, H + 0.8, W / 2 + 0.35, 0],
  ]) {
    const m = sombra(new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, d), meioFio));
    m.position.set(x, 0.07, z);
    grupoLote.add(m);
  }
  for (const [x, z] of [[-W / 2 - 0.6, -H / 2 - 0.6], [W / 2 + 0.6, -H / 2 - 0.6], [-W / 2 - 0.6, H / 2 + 0.6], [W / 2 + 0.6, H / 2 + 0.6]]) {
    const p = criarPoste(x, z);
    p.rotation.y = Math.atan2(z, -x); // braço (+X local) apontando para o centro do lote
    grupoLote.add(p);
  }

  const paraMundo = ([x, y]) => new THREE.Vector3((x - api.largura / 2) * ESCALA, 0, (y - api.altura / 2) * ESCALA);
  const centroLote = new THREE.Vector3();
  const centros = api.vagas.map((v) => {
    const c = new THREE.Vector3();
    v.pontos.forEach((p) => c.add(paraMundo(p)));
    return c.divideScalar(v.pontos.length);
  });
  centros.forEach((c) => centroLote.add(c));
  if (centros.length) centroLote.divideScalar(centros.length);

  api.vagas.forEach((v, i) => {
    const pts = v.pontos.map(paraMundo);
    const forma = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, p.z)));
    const geo = new THREE.ExtrudeGeometry(forma, { depth: 0.03, bevelEnabled: false });
    geo.rotateX(Math.PI / 2); // plano XY -> chão XZ (extrusão para baixo)
    const mat = new THREE.MeshStandardMaterial({
      color: COR_INDEF.clone(), emissive: COR_INDEF.clone(), emissiveIntensity: 0.25,
      roughness: 0.6, transparent: true, opacity: 0.9,
    });
    const piso = new THREE.Mesh(geo, mat);
    piso.position.y = 0.065;
    piso.receiveShadow = true;
    grupoVagas.add(piso);

    const contorno = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, 0.07, p.z))),
      new THREE.LineBasicMaterial({ color: 0xf8fafc })
    );
    grupoVagas.add(contorno);

    // eixo longo da vaga e direção do corredor (para onde o carro sai)
    const e1 = pts[1].clone().sub(pts[0]), e2 = pts[2].clone().sub(pts[1]);
    const longo = e1.length() >= e2.length() ? e1 : e2;
    const curto = longo === e1 ? e2 : e1;
    const dir = longo.clone().normalize();
    const paraCentro = centroLote.clone().sub(centros[i]);
    const entrada = paraCentro.dot(dir) >= 0 ? dir : dir.clone().negate();

    const rotulo = etiqueta(v.id);
    rotulo.position.copy(centros[i]).setY(1.25);
    grupoVagas.add(rotulo);

    objetos.push({
      id: v.id, piso, centro: centros[i], entrada, comp: longo.length(), larg: curto.length(),
      carro: null, estado: undefined, anim: null,
    });
  });

  // enquadra a câmera
  const raio = Math.max(W, H);
  controles.target.set(0, 0, 0);
  camera.position.set(raio * 0.25, raio * 0.75, raio * 0.85);
  controles.update();
}

// ---------------- Animação de entrada/saída ----------------
const suave = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function posicaoFora(o) {
  return o.centro.clone().addScaledVector(o.entrada, o.comp * 1.1);
}

function estacionar(o, cor, animar) {
  if (o.carro) { grupoVagas.remove(o.carro); liberar(o.carro); }
  const carro = criarCarro(cor, o.comp, o.larg);
  // frente do carro (+Z local) aponta para dentro da vaga (oposto ao corredor)
  carro.rotation.y = Math.atan2(-o.entrada.x, -o.entrada.z);
  grupoVagas.add(carro);
  o.carro = carro;
  if (animar) {
    carro.position.copy(posicaoFora(o));
    o.anim = { carro, de: posicaoFora(o), para: o.centro.clone(), t0: performance.now(), aoFim: null };
  } else {
    carro.position.copy(o.centro);
    o.anim = null;
  }
}

function sair(o) {
  if (!o.carro) return;
  const carro = o.carro;
  o.anim = {
    carro, de: carro.position.clone(), para: posicaoFora(o), t0: performance.now(),
    aoFim: () => { grupoVagas.remove(carro); liberar(carro); if (o.carro === carro) o.carro = null; },
  };
}

function atualizar(api) {
  const agora = performance.now();
  api.estados.forEach((e, i) => {
    const o = objetos[i];
    if (!o) return;
    if (e.ocupada !== o.estado) {
      const primeiro = o.estado === undefined || o.estado === null;
      if (e.ocupada === true) {
        const rgb = window.estacionamento.corDoCarro(o.id);
        const cor = rgb ? new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace) : hashCor(o.id);
        estacionar(o, cor, !primeiro);
      } else if (e.ocupada === false && o.carro) {
        sair(o);
      }
      o.estado = e.ocupada;
    }
    const alvo = e.ocupada === true ? COR_OCUPADA : e.ocupada === false ? COR_LIVRE : COR_INDEF;
    o.piso.material.color.lerp(alvo, 0.08);
    o.piso.material.emissive.lerp(alvo, 0.08);
    // vagas livres "respiram" levemente
    o.piso.material.emissiveIntensity = e.ocupada === false ? 0.3 + 0.15 * Math.sin(agora / 500 + i) : 0.2;

    if (o.anim) {
      const t = Math.min(1, (agora - o.anim.t0) / DURACAO_ANIM);
      o.anim.carro.position.copy(o.anim.de).lerp(o.anim.para, suave(t));
      if (t >= 1) {
        const fim = o.anim.aoFim;
        o.anim = null;
        if (fim) fim();
      }
    }
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

  const tamanho = `${api.largura}x${api.altura}`;
  if (api.estados !== refEstados || tamanho !== refTamanho) {
    construir(api);
    refEstados = api.estados;
    refTamanho = tamanho;
  }
  atualizar(api);

  const livres = api.estados.filter((e) => e.ocupada === false).length;
  document.getElementById("placar3d").textContent = `${livres} / ${api.vagas.length}`;

  if (host.offsetParent === null) return; // aba oculta: não renderiza
  controles.update();
  renderer.render(cena, camera);
}
redimensionar();
quadro();
