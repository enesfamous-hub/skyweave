// 3B dünya küresi: harita dokusu, sınırlar, güneş, rotalar ve uçaklar.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const D2R = Math.PI / 180;
const OCEAN = '#0d2138', LAND = '#1e3652', HOME = '#2b5079';

// Enlem/boylam → küre üzerindeki nokta (SphereGeometry doku yerleşimiyle uyumlu).
export function ll2v(lat, lon, r = 1) {
  const la = lat * D2R, lo = lon * D2R;
  return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

// İki havaalanı arası, yükselen büyük daire yayı.
function arcPoints(a, b, n, lift) {
  const A = ll2v(a.lat, a.lon), B = ll2v(b.lat, b.lon);
  const om = A.angleTo(B), s = Math.sin(om);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const v = om < 1e-6 ? A.clone()
      : A.clone().multiplyScalar(Math.sin((1 - t) * om) / s).add(B.clone().multiplyScalar(Math.sin(t * om) / s));
    v.normalize().multiplyScalar(1.002 + lift * Math.sin(Math.PI * t));
    pts.push(v);
  }
  return pts;
}

export class Globe {
  constructor(el) {
    this.el = el;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04070d);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.002, 200);
    this.camera.position.copy(ll2v(39, 35, 2.4));

    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.enablePan = false; c.enableDamping = true; c.dampingFactor = 0.08;
    c.minDistance = 1.03; c.maxDistance = 5;
    c.addEventListener('start', () => { this.fly = null; });

    // Dünya
    this.texCanvas = document.createElement('canvas');
    const max = r.capabilities.maxTextureSize;
    this.texCanvas.width = Math.min(8192, max); this.texCanvas.height = this.texCanvas.width / 2;
    const tctx = this.texCanvas.getContext('2d');
    tctx.fillStyle = OCEAN; tctx.fillRect(0, 0, this.texCanvas.width, this.texCanvas.height);
    this.texture = new THREE.CanvasTexture(this.texCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = r.capabilities.getMaxAnisotropy();
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 160, 120),
      new THREE.MeshPhongMaterial({ map: this.texture, shininess: 10, specular: new THREE.Color(0x1a2a3a) })
    );
    this.scene.add(this.earth);

    // Atmosfer parıltısı
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 48),
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'varying vec3 vN; void main(){ float i = pow(0.72 - dot(vN, vec3(0.0, 0.0, 1.0)), 3.0); gl_FragColor = vec4(0.35, 0.65, 1.0, 1.0) * i; }',
        side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      })
    );
    atmo.scale.setScalar(1.13);
    this.scene.add(atmo);

    // Yıldızlar
    const sp = [];
    for (let i = 0; i < 1800; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 40); sp.push(v.x, v.y, v.z); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9fb4d0, size: 0.25, sizeAttenuation: true })));

    // Işık: güneş + gece tarafı için hafif ortam ışığı
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0x7d8fb8, 0.7));

    this.routeGroup = new THREE.Group(); this.scene.add(this.routeGroup);
    this.planeGroup = new THREE.Group(); this.scene.add(this.planeGroup);
    this.routeObjs = new Map();
    this.lineMats = new Set();
    this.planes = [];
    this.planeGeo = new THREE.ConeGeometry(0.007, 0.024, 3);
    this.planeGeo.rotateX(Math.PI / 2);
    this.preview = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.lineMats.forEach(m => m.resolution.set(w, h));
  }

  // Natural Earth ülke verisini yükle: dolgu dokuya, sınırlar çizgi olarak.
  async loadMap(url, homeId) {
    try {
      const topo = await (await fetch(url)).json();
      const geo = topojson.feature(topo, topo.objects.countries);
      const cv = this.texCanvas, ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      const px = lon => (lon + 180) / 360 * W, py = lat => (90 - lat) / 180 * H;
      ctx.fillStyle = OCEAN; ctx.fillRect(0, 0, W, H);
      for (const f of geo.features) {
        const g = f.geometry; if (!g) continue;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        ctx.beginPath();
        for (const poly of polys) for (const ring of poly) {
          let prev = ring[0][0];
          ring.forEach((p, i) => {
            let lon = p[0];
            while (lon - prev > 180) lon -= 360;
            while (lon - prev < -180) lon += 360;
            prev = lon;
            if (i) ctx.lineTo(px(lon), py(p[1])); else ctx.moveTo(px(lon), py(p[1]));
          });
          ctx.closePath();
        }
        ctx.fillStyle = f.id === homeId ? HOME : LAND;
        for (const off of [-W, 0, W]) { ctx.save(); ctx.translate(off, 0); ctx.fill('evenodd'); ctx.restore(); }
      }
      this.texture.needsUpdate = true;

      const mesh = topojson.mesh(topo, topo.objects.countries);
      const pos = [];
      for (const line of mesh.coordinates) for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        if (Math.abs(a[0] - b[0]) > 180) continue;
        const va = ll2v(a[1], a[0], 1.0005), vb = ll2v(b[1], b[0], 1.0005);
        pos.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
      }
      const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.scene.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0x8fb3d9, transparent: true, opacity: 0.35 })));
    } catch (e) {
      console.warn('Harita yüklenemedi:', e);
    }
  }

  setSun(date) {
    const doy = (date - Date.UTC(date.getUTCFullYear(), 0, 1)) / 864e5;
    const decl = -23.44 * Math.cos(2 * Math.PI * (doy + 10) / 365);
    const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
    this.sun.position.copy(ll2v(decl, (12 - hours) * 15, 10));
  }

  makeLine(points, color, width, opacity = 1) {
    const g = new LineGeometry();
    g.setPositions(points.flatMap(p => [p.x, p.y, p.z]));
    const m = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity });
    m.resolution.set(this.w, this.h);
    this.lineMats.add(m);
    return new Line2(g, m);
  }

  disposeLine(obj) {
    obj.geometry.dispose(); obj.material.dispose(); this.lineMats.delete(obj.material);
  }

  // routes: [{id, a, b, color, km}]
  setRoutes(routes, selectedId) {
    for (const [id, o] of this.routeObjs) { this.routeGroup.remove(o); this.disposeLine(o); }
    this.routeObjs.clear();
    for (const r of routes) {
      const lift = 0.006 + 0.09 * Math.min(1, r.km / 12000);
      const o = this.makeLine(arcPoints(r.a, r.b, 64, lift), r.color, r.id === selectedId ? 5 : 3);
      this.routeGroup.add(o);
      this.routeObjs.set(r.id, o);
    }
  }

  setPreview(a, b, ok) {
    if (this.preview) { this.scene.remove(this.preview); this.disposeLine(this.preview); this.preview = null; }
    if (!a || !b) return;
    const km = a && b ? A_B_KM(a, b) : 0;
    this.preview = this.makeLine(arcPoints(a, b, 64, 0.006 + 0.09 * Math.min(1, km / 12000)), ok ? 0xffffff : 0xef476f, 3, 0.8);
    this.scene.add(this.preview);
  }

  // planes: [{a, b, km, color, rt (saat), dwell (0-0.5), phase}]
  setPlanes(planes) {
    this.planes.forEach(p => { this.planeGroup.remove(p.mesh); p.mesh.material.dispose(); });
    this.planes = planes.map(p => {
      const lift = 0.006 + 0.09 * Math.min(1, p.km / 12000);
      const mesh = new THREE.Mesh(this.planeGeo, new THREE.MeshBasicMaterial({ color: p.color }));
      this.planeGroup.add(mesh);
      return { ...p, pts: arcPoints(p.a, p.b, 96, lift + 0.003), mesh };
    });
  }

  updatePlanes(tHours) {
    const dist = this.camera.position.length();
    const scale = THREE.MathUtils.clamp((dist - 1) * 1.1, 0.06, 1.6);
    for (const p of this.planes) {
      const cyc = ((tHours / p.rt) + p.phase) % 1;
      const half = cyc < 0.5 ? cyc * 2 : (cyc - 0.5) * 2; // 0..1 her bacakta
      const fwd = cyc < 0.5;
      let u = THREE.MathUtils.clamp((half - p.dwell) / (1 - p.dwell), 0, 1);
      if (!fwd) u = 1 - u;
      const n = p.pts.length - 1;
      const f = u * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
      const pos = p.pts[i].clone().lerp(p.pts[i + 1], k);
      const ahead = fwd ? p.pts[i + 1] : p.pts[i];
      p.mesh.position.copy(pos);
      p.mesh.up.copy(pos).normalize();
      const tgt = ahead.equals(pos) ? p.pts[fwd ? Math.min(n, i + 2) : Math.max(0, i - 1)] : ahead;
      p.mesh.lookAt(tgt);
      p.mesh.scale.setScalar(scale);
      p.mesh.visible = !(half < p.dwell); // yerdeyken gizle
    }
  }

  // Ekran koordinatı; arka yüzdeyse visible=false.
  project(lat, lon) {
    const v = ll2v(lat, lon, 1.001);
    const visible = v.dot(this.camera.position) > 1.003;
    const p = v.project(this.camera);
    return { x: (p.x + 1) / 2 * this.w, y: (1 - p.y) / 2 * this.h, visible: visible && p.z < 1 };
  }

  get distance() { return this.camera.position.length(); }

  flyTo(lat, lon, dist) {
    this.fly = ll2v(lat, lon, dist ?? this.distance);
  }

  render(dt) {
    if (this.fly) {
      const k = 1 - Math.exp(-dt * 3.5);
      // Küre yüzeyinde yay boyunca ilerle (içinden geçmesin)
      const cur = this.camera.position, len = cur.length() + (this.fly.length() - cur.length()) * k;
      const dir = cur.clone().normalize().lerp(this.fly.clone().normalize(), k).normalize();
      cur.copy(dir.multiplyScalar(len));
      if (cur.distanceTo(this.fly) < 0.002) this.fly = null;
    }
    const d = this.distance;
    this.controls.rotateSpeed = THREE.MathUtils.clamp((d - 1) * 0.55, 0.02, 1);
    this.controls.zoomSpeed = THREE.MathUtils.clamp((d - 1) * 0.9, 0.25, 1.2);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

function A_B_KM(a, b) {
  return ll2v(a.lat, a.lon).angleTo(ll2v(b.lat, b.lon)) * 6371;
}
