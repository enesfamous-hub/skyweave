// Havaalanı yakın plan görünümü: pistler, terminal, kule, apron ve canlı trafik.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RUNWAYS } from './runways.js';

const D2R = Math.PI / 180;
const TS = 2.5;                 // görsel zaman hızı (gerçek hayata göre)
const OUR_TAIL = 0xffd166;
const OTHER_TAILS = [0xd62828, 0x1d4e89, 0x2a9d8f, 0x6a4c93, 0xe76f51, 0x264653, 0x8d99ae, 0x118ab2];
const DESERT = ['AE', 'QA', 'SA', 'KW', 'EG', 'JO', 'DZ', 'TN', 'IR'];

function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Pist listesi: veri varsa onu, yoksa nüfusa göre otomatik düzen.
export function runwaysFor(ap) {
  if (RUNWAYS[ap.c]) return RUNWAYS[ap.c].map(([h, l, o]) => ({ h, l, o }));
  const r = rng(hash(ap.c));
  const h = Math.floor(r() * 18) * 10 + 5;
  const L = Math.round(2700 + Math.min(1300, ap.p * 70));
  if (ap.p >= 12) return [{ h, l: L, o: -900 }, { h, l: L - 300, o: -500 }, { h, l: L, o: 1100 }];
  if (ap.p >= 4) return [{ h, l: L, o: -200 }, { h, l: L - 400, o: 200 }];
  return [{ h, l: L, o: 0 }];
}

// Güneşin havaalanına göre yerel yönü (x doğu, y yukarı, z güney).
function sunLocal(date, ap) {
  const doy = (date - Date.UTC(date.getUTCFullYear(), 0, 1)) / 864e5;
  const decl = -23.44 * Math.cos(2 * Math.PI * (doy + 10) / 365) * D2R;
  const sLon = (12 - date.getUTCHours() - date.getUTCMinutes() / 60) * 15 * D2R;
  const S = [Math.cos(decl) * Math.cos(sLon), Math.sin(decl), -Math.cos(decl) * Math.sin(sLon)];
  const la = ap.lat * D2R, lo = ap.lon * D2R;
  const U = [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
  const E = [-Math.sin(lo), 0, -Math.cos(lo)];
  const N = [-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return new THREE.Vector3(dot(S, E), dot(S, U), -dot(S, N));
}

function runwayTexture(L, W, numA, numB) {
  const cv = document.createElement('canvas');
  cv.width = 4096; cv.height = 128;
  const c = cv.getContext('2d');
  const sx = cv.width / L, sy = cv.height / W;
  c.fillStyle = '#2b2e34'; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = '#e9e9e4';
  c.fillRect(0, 1 * sy, cv.width, 0.9 * sy);
  c.fillRect(0, cv.height - 1.9 * sy, cv.width, 0.9 * sy);
  for (let x = 160; x < L - 160; x += 50) c.fillRect(x * sx, cv.height / 2 - 0.5 * sy, 30 * sx, 1 * sy);
  for (const x0 of [6, L - 36]) {
    for (let i = 0; i < 12; i++) {
      const y = 3 + i * (W - 6) / 12;
      if (Math.abs(y + 0.9 - W / 2) < 3) continue;
      c.fillRect(x0 * sx, y * sy, 30 * sx, 1.8 * sy);
    }
  }
  // Dokunma noktası işaretleri
  for (const x0 of [300, L - 330]) { c.fillRect(x0 * sx, (W / 2 - 9) * sy, 45 * sx, 3 * sy); c.fillRect(x0 * sx, (W / 2 + 6) * sy, 45 * sx, 3 * sy); }
  c.font = 'bold 34px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.save(); c.translate(62 * sx, cv.height / 2); c.rotate(Math.PI / 2); c.fillText(numA, 0, 0); c.restore();
  c.save(); c.translate((L - 62) * sx, cv.height / 2); c.rotate(-Math.PI / 2); c.fillText(numB, 0, 0); c.restore();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const desig = h => String(Math.round((((h % 360) + 360) % 360) / 10) || 36).padStart(2, '0');

// Basit ama tanınır uçak modeli (burun +X yönünde).
class PlaneFactory {
  constructor() {
    this.white = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.45, metalness: 0.1 });
    this.grey = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.5, metalness: 0.3 });
    this.glass = new THREE.MeshStandardMaterial({ color: 0x1b2633, roughness: 0.2 });
    this.tails = new Map();
    const g = this.g = {};
    g.fus = new THREE.CylinderGeometry(1.95, 1.95, 30, 14); g.fus.rotateZ(Math.PI / 2);
    g.nose = new THREE.SphereGeometry(1.95, 14, 10); g.nose.scale(2.2, 1, 1);
    g.cone = new THREE.ConeGeometry(1.95, 9, 14); g.cone.rotateZ(Math.PI / 2);
    g.wing = new THREE.BoxGeometry(6, 0.45, 34);
    g.hstab = new THREE.BoxGeometry(3.2, 0.3, 12);
    g.fin = new THREE.BoxGeometry(6, 7.5, 0.45);
    g.eng = new THREE.CylinderGeometry(1.15, 1.15, 4.2, 12); g.eng.rotateZ(Math.PI / 2);
    g.cockpit = new THREE.BoxGeometry(1.6, 0.8, 2.6);
    g.stripe = new THREE.BoxGeometry(30, 0.5, 4.0);
  }
  tail(color) {
    if (!this.tails.has(color)) this.tails.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    return this.tails.get(color);
  }
  make(tailColor, scale = 1, ours = false) {
    const { g } = this, grp = new THREE.Group();
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); grp.add(m); return m; };
    add(g.fus, this.white, 0, 0, 0);
    add(g.nose, this.white, 15, 0, 0);
    const cone = add(g.cone, this.white, -19.4, 0.6, 0); cone.rotation.z = Math.PI;
    add(g.cockpit, this.glass, 17.2, 0.85, 0);
    const w = add(g.wing, this.white, -1, -0.9, 0); w.rotation.y = 0.12;
    add(g.hstab, this.white, -21, 1.2, 0);
    add(g.fin, this.tail(tailColor), -20.5, 4.8, 0);
    add(g.eng, this.grey, 2, -2.1, 6.2);
    add(g.eng, this.grey, 2, -2.1, -6.2);
    if (ours) add(g.stripe, this.tail(tailColor), 0, -0.2, 0).scale.set(1, 1, 0.5);
    grp.scale.setScalar(scale);
    grp.rotation.order = 'YZX';
    return grp;
  }
}

export class AirportView {
  constructor(el) {
    this.el = el;
    this.active = false;
    this.renderer = null;
  }

  ensureRenderer() {
    if (this.renderer) return;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    this.el.appendChild(r.domElement);
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 60000);
    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.enableDamping = true; c.dampingFactor = 0.08;
    c.minDistance = 80; c.maxDistance = 14000;
    c.maxPolarAngle = 1.48;
    c.screenSpacePanning = false;
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.renderer) return;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  // info: { ours: bizim uçak sayısı, share: trafikteki payımız (0-1) }
  open(ap, info) {
    this.ensureRenderer();
    this.ap = ap;
    this.info = info;
    this.active = true;
    this.resize();
    this.build();
  }

  close() {
    this.active = false;
    if (this.scene) {
      this.scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      });
    }
    this.scene = null;
    this.movers = [];
  }

  // ---------- Sahne ----------
  build() {
    const ap = this.ap, R = rng(hash(ap.c) ^ 0x9e37);
    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x9cc8ea, 6000, 26000);
    this.planes = new PlaneFactory();

    // Işıklar
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x55603f, 1);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.5);
    scene.add(this.hemi, this.sun);

    // Zemin
    const sand = DESERT.includes(ap.co);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshStandardMaterial({ color: sand ? 0xc4ab82 : 0x5b7a4a, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Tüm havaalanı ana pist yönünde döndürülmüş bir grupta; grup içinde ana pist X ekseni boyunca.
    const rws = runwaysFor(ap);
    const main = rws[0];
    const root = this.root = new THREE.Group();
    root.rotation.y = (90 - main.h) * D2R;
    scene.add(root);

    this.rwys = rws.map((r, i) => {
      let rel = ((main.h - r.h) % 180 + 270) % 180 - 90; // -90..90
      const parallel = Math.abs(rel) < 15;
      if (parallel) rel = 0;
      return { ...r, i, rel, parallel, z: r.o - main.o, hX: main.h - rel, w: r.l > 3500 ? 60 : 45 };
    });
    const par = this.rwys.filter(r => r.parallel);

    // Terminal yeri: pistler arasında yeterli boşluk varsa oraya, yoksa dışarıya.
    const zs = par.map(r => r.z).sort((a, b) => a - b);
    let ref = zs[zs.length - 1], side = 1;
    for (let i = 0; i < zs.length - 1; i++) if (zs[i + 1] - zs[i] >= 1500) { ref = zs[i]; side = 1; break; }
    if (ref === zs[zs.length - 1] && zs.length > 1 && R() < 0.5) { ref = zs[0]; side = -1; }
    if (zs.length === 1) side = R() < 0.5 ? 1 : -1;
    this.side = side; this.refZ = ref;
    const Z = d => ref + side * d;  // ana referans pistten terminale doğru mesafe
    this.taxiZ = Z(190);

    const asphalt = new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.95 });
    const concrete = this.apronMat = new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.95, emissive: 0x6b5a3a, emissiveIntensity: 0 });
    const yellow = new THREE.MeshBasicMaterial({ color: 0xd9b23a });
    const flat = (w, d, mat, x, y, z, rotY = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      m.rotation.x = -Math.PI / 2; m.rotation.z = rotY; m.position.set(x, y, z);
      root.add(m); return m;
    };

    // Pistler
    for (const r of this.rwys) {
      const tex = runwayTexture(r.l, r.w, desig(r.hX), desig(r.hX + 180));
      const m = flat(r.l, r.w, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), 0, 0.5, r.z, r.rel * D2R);
      r.mesh = m;
    }

    // Taksi yolları: her paralel pistin terminal tarafında
    for (const r of par) {
      const s = Math.sign(Z(400) - r.z) || side;
      r.taxiZ = r.z + s * 190;
      flat(r.l, 23, asphalt, 0, 0.3, r.taxiZ);
      flat(r.l, 0.8, yellow, 0, 0.35, r.taxiZ);
      for (const fx of [-0.5, -0.32, -0.1, 0.1, 0.32, 0.5]) {
        const x = fx * (r.l - 80);
        flat(23, 190, asphalt, x, 0.3, (r.z + r.taxiZ) / 2);
      }
    }
    // Ana taksi yolundan diğer pistlerin taksi yollarına bağlantı
    const mainRef = par.find(r => r.z === ref) || par[0];
    this.mainL = mainRef.l;

    // Terminal ve iskeleler
    const Lt = Math.max(300, Math.min(1100, Math.max(250 + ap.p * 45, rws.length * 300)));
    const k = Math.max(1, Math.min(4, Math.round(Lt / 280)));
    flat(Lt + 360, 430, concrete, 0, 0.2, Z(440));                 // apron
    flat(Lt + 300, 180, asphalt, 0, 0.2, Z(870));                  // otopark
    flat(Lt + 900, 18, asphalt, 0, 0.25, Z(780));                  // yol

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.6, metalness: 0.2 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xb7c0c9, roughness: 0.5, metalness: 0.4 });
    this.windowMat = new THREE.MeshStandardMaterial({ color: 0x2c4a66, roughness: 0.15, metalness: 0.6, emissive: 0xffd58a, emissiveIntensity: 0 });
    const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); root.add(m); return m; };

    box(Lt, 24, 90, bodyMat, 0, 12, Z(700));
    box(Lt + 8, 3, 96, roofMat, 0, 25, Z(700));
    box(Lt - 10, 12, 1, this.windowMat, 0, 12, Z(654));

    // İskeleler ve park yerleri
    this.stands = [];
    for (let j = 0; j < k; j++) {
      const px = -Lt / 2 + Lt * (j + 0.5) / k;
      box(28, 11, 230, bodyMat, px, 5.5, Z(540));
      box(28.5, 1.2, 231, roofMat, px, 11.6, Z(540));
      box(29, 5, 220, this.windowMat, px, 6, Z(540)).scale.set(1.01, 1, 0.98);
      for (let i = 0; i < 3; i++) {
        const sz = Z(620 - 60 - i * 72);
        for (const out of [-1, 1]) {
          const sx = px + out * (14 + 23);
          this.stands.push({ x: sx, z: sz, out, occ: null, reserved: false });
          box(10, 3.5, 3, bodyMat, px + out * 19, 5, sz); // körük
        }
      }
    }

    // Kule
    const towerX = Lt / 2 + 220;
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 6.5, 62, 16), bodyMat);
    tw.position.set(towerX, 31, Z(600)); root.add(tw);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(9, 7, 7, 16), this.windowMat);
    cab.position.set(towerX, 65, Z(600)); root.add(cab);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 9.5, 1.5, 16), roofMat);
    cap.position.set(towerX, 69, Z(600)); root.add(cap);

    // Hangarlar
    for (let i = 0; i < 2; i++) box(90, 26, 70, roofMat, -Lt / 2 - 220 - i * 110, 13, Z(560));

    // Çevredeki şehir (yaklaşma koridorunda bina yok)
    const n = 420;
    const cityMat = new THREE.MeshStandardMaterial({ color: 0x9a9690, roughness: 0.9, emissive: 0xffcf7a, emissiveIntensity: 0 });
    this.cityMat = cityMat;
    const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cityMat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    let placed = 0;
    while (placed < n) {
      const ang = R() * Math.PI * 2, dist = 3500 + R() * 7000;
      const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
      if (Math.abs(z - ref) < 1300 && Math.abs(x) > 1500) continue;
      if (Math.abs(z - ref) < 2600 && Math.abs(x) < this.mainL / 2 + 800) continue;
      const h = 8 + Math.pow(R(), 3) * (ap.p > 8 ? 120 : 45);
      pos.set(x, h / 2, z); sc.set(25 + R() * 50, h, 25 + R() * 50);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * Math.PI);
      city.setMatrixAt(placed++, m4.compose(pos, q, sc));
    }
    root.add(city);

    // Gece ışıkları
    const lights = [], greens = [], blues = [];
    for (const r of this.rwys) {
      const c = Math.cos(-r.rel * D2R), s = Math.sin(-r.rel * D2R);
      const put = (arr, lx, lz) => arr.push(lx * c - lz * s, 1.5, r.z + lx * s + lz * c);
      for (let x = -r.l / 2; x <= r.l / 2; x += 60) { put(lights, x, -r.w / 2 - 1); put(lights, x, r.w / 2 + 1); }
      for (let z = -r.w / 2; z <= r.w / 2; z += 4) { put(greens, -r.l / 2, z); put(greens, r.l / 2, z); }
    }
    for (const r of par) for (let x = -r.l / 2; x <= r.l / 2; x += 50) { blues.push(x, 1, r.taxiZ - 13, x, 1, r.taxiZ + 13); }
    const pts = (arr, color, size) => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const p = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, depthWrite: false }));
      root.add(p); return p;
    };
    this.nightLights = [pts(lights, 0xfff0c0, 3), pts(greens, 0x59ff8a, 3.5), pts(blues, 0x4f8dff, 2.5)];

    // Trafik
    this.movers = [];
    this.wind = R() < 0.5 ? 1 : -1;            // aktif pist yönü
    this.spawnT = 2;
    this.interval = Math.max(6, Math.min(20, 28 / Math.sqrt(ap.p + 0.5)));
    const fill = Math.min(this.stands.length, Math.round(this.stands.length * 0.65));
    const idx = this.stands.map((_, i) => i).sort(() => R() - 0.5);
    let ours = Math.min(this.info.ours, Math.ceil(this.stands.length / 2));
    for (let i = 0; i < Math.max(fill, ours); i++) {
      const st = this.stands[idx[i]];
      const our = ours-- > 0;
      this.parkAt(st, this.newPlane(our), 6 + R() * 50);
    }
    this.spawnLanding(0.35);

    // Kamera: terminalin önünden pistlere bakış
    const camTarget = new THREE.Vector3(0, 0, Z(320)).applyEuler(root.rotation);
    const camPos = new THREE.Vector3(-Lt * 0.5 - 420, 300, Z(1050)).applyEuler(root.rotation);
    this.controls.target.copy(camTarget);
    this.camera.position.copy(camPos);
    this.controls.update();
  }

  newPlane(ours) {
    const tail = ours ? OUR_TAIL : OTHER_TAILS[Math.floor(Math.random() * OTHER_TAILS.length)];
    const scale = Math.random() < 0.18 ? 1.5 : 1;
    const obj = this.planes.make(tail, scale, ours);
    obj.userData.ours = ours;
    this.root.add(obj);
    return obj;
  }

  parkAt(st, obj, waitS) {
    st.occ = obj; st.reserved = false;
    obj.position.set(st.x, 3.4, st.z);
    obj.rotation.set(0, st.out > 0 ? Math.PI : 0, 0, 'YZX');
    obj.userData.stand = st;
    obj.userData.departIn = waitS;
  }

  // ---------- Trafik ----------
  pickRunway() {
    const par = this.rwys.filter(r => r.parallel);
    return Math.random() < 0.6 ? par.find(r => r.z === this.refZ) || par[0] : par[Math.floor(Math.random() * par.length)];
  }

  spawnLanding(progress = 0) {
    const free = this.stands.filter(s => !s.occ && !s.reserved);
    if (!free.length) return;
    const st = free[Math.floor(Math.random() * free.length)];
    st.reserved = true;
    const ours = Math.random() < this.info.share;
    const obj = this.newPlane(ours);
    const r = this.pickRunway(), w = this.wind;
    const thr = -w * r.l / 2, V = (x, y, z) => new THREE.Vector3(x, y, z);
    const exitX = thr + w * Math.min(r.l - 500, 1900);
    const path = [
      { p: V(thr - w * 4500, 250, r.z), v: 75, pitch: 0.05 },
      { p: V(thr, 18, r.z), v: 72, pitch: 0.06 },
      { p: V(thr + w * 420, 3.4, r.z), v: 66, pitch: 0.03 },
      { p: V(exitX - w * 150, 3.4, r.z), v: 16 },
      { p: V(exitX, 3.4, r.taxiZ), v: 10 },
    ];
    if (r.taxiZ !== this.taxiZ) path.push({ p: V(exitX, 3.4, this.taxiZ), v: 10 });
    path.push(
      { p: V(st.x + st.out * 70, 3.4, this.taxiZ), v: 12 },
      { p: V(st.x + st.out * 70, 3.4, st.z), v: 6 },
      { p: V(st.x, 3.4, st.z), v: 1.5 },
    );
    this.addMover(obj, path, () => this.parkAt(st, obj, 25 + Math.random() * 50), progress);
  }

  spawnTakeoff(st) {
    const obj = st.occ;
    st.occ = null;
    const r = this.rwys.find(x => x.parallel && x.z === this.refZ) || this.pickRunway();
    const w = this.wind, start = -w * (r.l / 2 - 60), V = (x, y, z) => new THREE.Vector3(x, y, z);
    const path = [
      { p: V(st.x, 3.4, st.z), v: 2, rev: true },
      { p: V(st.x + st.out * 50, 3.4, st.z), v: 5 },
      { p: V(st.x + st.out * 70, 3.4, this.taxiZ), v: 12 },
      { p: V(start + w * 60, 3.4, this.taxiZ), v: 8 },
      { p: V(start, 3.4, r.z), v: 3 },
      { p: V(start + w * 1900, 3.4, r.z), v: 82 },
      { p: V(start + w * 2700, 70, r.z), v: 86 },
      { p: V(start + w * 9500, 950, r.z), v: 95 },
    ];
    this.addMover(obj, path, () => { this.root.remove(obj); });
  }

  addMover(obj, path, done, progress = 0) {
    const m = { obj, path, seg: 0, s: 0, done };
    this.movers.push(m);
    if (progress > 0) {
      const len = path[1].p.distanceTo(path[0].p);
      m.s = len * progress;
    }
    this.placeMover(m, 1);
  }

  placeMover(m, dt) {
    const a = m.path[m.seg], b = m.path[m.seg + 1];
    const len = a.p.distanceTo(b.p) || 1;
    const u = Math.min(1, m.s / len);
    m.obj.position.lerpVectors(a.p, b.p, u);
    const d = b.p.clone().sub(a.p);
    if (a.rev) d.negate();
    const h = Math.hypot(d.x, d.z);
    if (h > 0.01) {
      const yaw = Math.atan2(-d.z, d.x);
      let cur = m.obj.rotation.y, diff = ((yaw - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      m.obj.rotation.y = cur + diff * Math.min(1, dt * 5);
    }
    const pitch = a.pitch ?? Math.atan2(a.rev ? 0 : d.y, h);
    m.obj.rotation.z += (pitch - m.obj.rotation.z) * Math.min(1, dt * 3);
    
  }

  updateTraffic(dt) {
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnLanding(); this.spawnT = this.interval * (0.7 + Math.random() * 0.6); }
    for (const st of this.stands) {
      if (!st.occ || this.movers.some(m => m.obj === st.occ)) continue;
      st.occ.userData.departIn -= dt;
      if (st.occ.userData.departIn <= 0) {
        // Pistte başka kalkış varsa bekle
        if (this.movers.filter(m => m.takeoff).length >= 2) { st.occ.userData.departIn = 4; continue; }
        this.spawnTakeoff(st);
        this.movers[this.movers.length - 1].takeoff = true;
      }
    }
    for (const m of [...this.movers]) {
      const a = m.path[m.seg], b = m.path[m.seg + 1];
      const len = a.p.distanceTo(b.p) || 1;
      const v = a.v + (b.v - a.v) * Math.min(1, m.s / len);
      m.s += Math.max(1, v) * dt;
      while (m.seg < m.path.length - 1) {
        const segLen = m.path[m.seg].p.distanceTo(m.path[m.seg + 1].p);
        if (m.s < segLen) break;
        m.s -= segLen;
        m.seg++;
      }
      if (m.seg >= m.path.length - 1) {
        this.movers.splice(this.movers.indexOf(m), 1);
        m.done();
        continue;
      }
      this.placeMover(m, dt);
    }
  }

  // ---------- Işık ----------
  updateSky(date) {
    const s = sunLocal(date, this.ap);
    const day = smooth(-0.1, 0.18, s.y);
    const dusk = smooth(-0.15, 0.02, s.y) * (1 - smooth(0.02, 0.25, s.y));
    this.sun.position.copy(s).multiplyScalar(5000);
    this.sun.intensity = 2.6 * day;
    this.sun.color.setRGB(1, 0.85 + 0.15 * day, 0.7 + 0.3 * day);
    this.hemi.intensity = 0.4 + 0.65 * day;
    const sky = new THREE.Color(0x070c18).lerp(new THREE.Color(0x8fc3ea), day).lerp(new THREE.Color(0xe08a5a), dusk * 0.6);
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    const night = 1 - smooth(-0.05, 0.12, s.y);
    this.windowMat.emissiveIntensity = night * 1.4;
    this.cityMat.emissiveIntensity = night * 0.35;
    this.apronMat.emissiveIntensity = night * 0.45;
    this.nightLights.forEach(p => { p.visible = night > 0.05; p.material.opacity = night; });
    return { day, sunUp: s.y > 0 };
  }

  render(dt, date) {
    if (!this.active || !this.scene) return;
    this.updateTraffic(dt * TS);
    this.updateSky(date);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  get runwayCount() { return this.rwys ? this.rwys.length : 0; }
  get activeRunway() {
    const r = this.rwys.find(x => x.parallel && x.z === this.refZ) || this.rwys[0];
    return desig(this.wind > 0 ? r.hX : r.hX + 180);
  }
  get parkedOurs() { return this.stands.filter(s => s.occ && s.occ.userData.ours).length; }
  get movingCount() { return this.movers.length; }
}
