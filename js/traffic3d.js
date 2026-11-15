// Havalimanında 3B uçaklar: gerçek kapılarda park, gerçek pistlerde iniş ve kalkış.
// Uçaklar haritanın 3B binalarıyla aynı tarzda (fill-extrusion bloklar) çizilir.

const TS = 2.5;                 // görsel zaman hızı
const OUR = '#ffc233';
const OTHERS = ['#d62828', '#1d4e89', '#2a9d8f', '#6a4c93', '#e76f51', '#264653', '#8d99ae', '#118ab2'];
const BODY = '#f3f5f8', ENG = '#98a2ad';

// Uçak parçaları (metre, burun +x yönünde). base: yerden yükseklik, h: kalınlık.
const mirror = pts => pts.map(([x, y]) => [x, -y]);
const WING = [[4, 1.9], [-4.5, 17], [-7.5, 17], [-4.5, 1.9]];
const STAB = [[-14.5, 1.5], [-18.2, 6.8], [-19.6, 6.8], [-18.4, 1.5]];
const ENGP = [[3.5, 5.3], [3.5, 7.7], [-0.9, 7.7], [-0.9, 5.3]];
const PARTS = [
  { pts: [[19, 0], [16.5, 1.95], [-14, 1.95], [-19, 0.7], [-19, -0.7], [-14, -1.95], [16.5, -1.95]], base: 1.6, h: 4, c: 'body' },
  { pts: WING, base: 2.6, h: 0.6, c: 'body' }, { pts: mirror(WING), base: 2.6, h: 0.6, c: 'body' },
  { pts: STAB, base: 4.8, h: 0.4, c: 'body' }, { pts: mirror(STAB), base: 4.8, h: 0.4, c: 'body' },
  { pts: [[-12.5, 0.3], [-19.7, 0.3], [-19.7, -0.3], [-12.5, -0.3]], base: 5.6, h: 6.5, c: 'tail' },
  { pts: ENGP, base: 0.9, h: 2.1, c: 'eng' }, { pts: mirror(ENGP), base: 0.9, h: 2.1, c: 'eng' },
];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const len = v => Math.hypot(v.x, v.y);
const unit = v => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class AirportTraffic {
  constructor(map, { airports, shareFor }) {
    this.map = map;
    this.airports = airports;
    this.shareFor = shareFor;
    this.livery = { tail: OUR, body: '#fff6dc' };
    this.ap = null;
    this.planes = [];
    this.movers = [];
    this.lastDraw = 0;
    this.pendingBuild = false;
  }

  attach() {
    const map = this.map;
    map.addSource('traffic3d', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'sw-traffic3d', type: 'fill-extrusion', source: 'traffic3d', minzoom: 12,
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-height': ['get', 'top'],
        'fill-extrusion-vertical-gradient': true,
      },
    });
    map.on('moveend', () => this.check());
    map.on('idle', () => { if (this.pendingBuild) this.tryBuild(); });
    this.check();
  }

  // Yakınlaşınca en yakın havalimanını bul, sahneyi kur.
  check() {
    const map = this.map, z = map.getZoom();
    if (z < 12) { this.clear(); return; }
    const c = map.getCenter();
    let best = null, bd = 14000;
    for (const ap of this.airports) {
      const d = Math.hypot((ap.lon - c.lng) * 111320 * Math.cos(c.lat * Math.PI / 180), (ap.lat - c.lat) * 110540);
      if (d < bd) { bd = d; best = ap; }
    }
    if (!best) { this.clear(); return; }
    if (best !== this.ap || !this.built) { this.ap = best; this.built = false; this.pendingBuild = true; this.tryBuild(); }
  }

  // Oyuncunun uçak boyası: { tail, body, wing }
  setLivery(l) { this.livery = { ...this.livery, ...l }; if (this.planes.length) this.draw(true); }

  clear() {
    if (!this.ap && !this.planes.length) return;
    this.ap = null; this.built = false; this.pendingBuild = false;
    this.planes = []; this.movers = []; this.stands = [];
    this.map.getSource('traffic3d')?.setData({ type: 'FeatureCollection', features: [] });
  }

  // Yerel metre koordinatları (havalimanı merkezli)
  toXY(lon, lat) { return { x: (lon - this.ap.lon) * this.kx, y: (lat - this.ap.lat) * 110540 }; }
  toLL(p) { return [this.ap.lon + p.x / this.kx, this.ap.lat + p.y / 110540]; }

  tryBuild() {
    if (!this.ap || this.map.getZoom() < 13) return;
    const map = this.map;
    const aero = map.querySourceFeatures('openmaptiles', { sourceLayer: 'aeroway' });
    const ap = this.ap;
    this.kx = 111320 * Math.cos(ap.lat * Math.PI / 180);
    const near = p => len(p) < 9000;
    // Bu havalimanının pist/apron verisi karolarda henüz yoksa biraz bekle (en fazla ~10 sn)
    const ready = aero.some(f => ['runway', 'apron', 'gate'].includes(f.properties.class) && (() => {
      const g = f.geometry, c = g.type === 'Point' ? g.coordinates : g.type === 'LineString' ? g.coordinates[0] : g.type === 'Polygon' ? g.coordinates[0][0] : null;
      return c && near(this.toXY(c[0], c[1]));
    })());
    if (!ready && (this.tries = (this.tries || 0) + 1) < 16) return;
    this.tries = 0;
    this.pendingBuild = false;
    this.built = true;

    // Pistler: ref'e göre birleştir, uç noktaları en uzak iki nokta
    const groups = new Map();
    aero.filter(f => f.properties.class === 'runway' && f.geometry.type === 'LineString').forEach((f, i) => {
      const key = f.properties.ref || 'r' + i;
      if (!groups.has(key)) groups.set(key, []);
      f.geometry.coordinates.forEach(([lo, la]) => groups.get(key).push(this.toXY(lo, la)));
    });
    this.runways = [];
    for (const pts of groups.values()) {
      const ps = pts.filter(near);
      if (ps.length < 2) continue;
      let A = ps[0], B = ps[1], best = 0;
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const d = dist(ps[i], ps[j]); if (d > best) { best = d; A = ps[i]; B = ps[j]; }
      }
      if (best > 1200) this.runways.push({ A, B, L: best });
    }
    if (!this.runways.length) {
      // Pist verisi yoksa: merkezden geçen hayali pist
      this.runways.push({ A: { x: -1500, y: 0 }, B: { x: 1500, y: 0 }, L: 3000 });
    }

    // Taksi yolu noktaları
    this.taxi = [];
    aero.filter(f => f.properties.class === 'taxiway').forEach(f => {
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
      lines.forEach(l => l.forEach(([lo, la]) => { const p = this.toXY(lo, la); if (near(p)) this.taxi.push(p); }));
    });

    // Bina merkezleri (uçağın burnunu terminale çevirmek için)
    const blds = map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' }).map(f => {
      const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates[0][0] : null;
      if (!ring) return null;
      const ps = ring.map(([lo, la]) => this.toXY(lo, la));
      const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      return { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length, size: w * h, ps };
    }).filter(b => b && b.size > 1500 && near(b));

    // Park yerleri: gerçek kapılar
    const seen = new Set();
    this.stands = [];
    for (const f of aero.filter(f => f.properties.class === 'gate' && f.geometry.type === 'Point')) {
      const [lo, la] = f.geometry.coordinates;
      const key = lo.toFixed(5) + la.toFixed(5);
      if (seen.has(key)) continue;
      seen.add(key);
      const g = this.toXY(lo, la);
      if (!near(g)) continue;
      // En yakın bina kenarı. Kapı binanın içindeyse uçak kenarın dışına, burnu binaya dönük park eder.
      let edge = null, bd = 260, inB = false;
      for (const b of blds) {
        const ins = inside(g, b.ps);
        for (let i = 0; i < b.ps.length - 1; i++) {
          const q = closestOnSeg(g, b.ps[i], b.ps[i + 1]), d = dist(g, q);
          if (d < bd) { bd = d; edge = q; inB = ins; }
        }
      }
      let dir, c;
      if (edge && inB) {
        const out = unit(sub(edge, g));       // binadan dışarı
        dir = { x: -out.x, y: -out.y };
        c = add(edge, out, 24);
      } else if (edge && bd > 1) {
        dir = unit(sub(edge, g));
        c = add(edge, dir, -24);
      } else {
        dir = unit({ x: rnd(-1, 1), y: rnd(-1, 1) });
        c = add(g, dir, -22);
      }
      if (blds.some(b => inside(c, b.ps))) continue;
      if (this.stands.some(s => dist(s.c, c) < 42)) continue;
      this.stands.push({ c, dir, occ: null, reserved: false });
    }
    // Kapı yoksa: apron içinde düzenli park yerleri
    if (this.stands.length < 4) {
      const aprons = aero.filter(f => f.properties.class === 'apron' && f.geometry.type === 'Polygon');
      for (const f of aprons) {
        const ps = f.geometry.coordinates[0].map(([lo, la]) => this.toXY(lo, la));
        const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length, cy = ps.reduce((s, p) => s + p.y, 0) / ps.length;
        const r = this.runways[0], ru = unit(sub(r.B, r.A)), perp = { x: -ru.y, y: ru.x };
        for (let i = -2; i <= 2; i++) {
          const c = add({ x: cx, y: cy }, ru, i * 50);
          if (inside(c, ps) && near(c)) this.stands.push({ c, dir: perp, occ: null, reserved: false });
        }
        if (this.stands.length > 12) break;
      }
    }
    this.stands = this.stands.slice(0, 60);

    // Başlangıç: kapıların ~%70'i dolu
    const info = this.shareFor(ap.c);
    this.share = info.share;
    this.others = info.others || [];
    this.planes = [];
    this.movers = [];
    let ours = Math.min(info.ours, Math.ceil(this.stands.length / 2));
    const order = this.stands.map((_, i) => i).sort(() => Math.random() - 0.5);
    const fill = Math.round(this.stands.length * 0.7);
    for (let i = 0; i < Math.max(fill, ours) && i < order.length; i++) {
      const st = this.stands[order[i]];
      const pl = this.newPlane(ours-- > 0);
      this.park(st, pl, rnd(5, 70));
    }
    this.wind = Math.random() < 0.5 ? 1 : -1;
    this.interval = Math.max(6, Math.min(22, 30 / Math.sqrt(ap.p + 0.5)));
    this.spawnT = 1;
    this.spawnLanding(0.45);
    this.draw(true);
  }

  newPlane(ours) {
    // Diğer uçaklar: o havalimanında uçan rakiplerin renkleri (sefer paylarına göre), kalanı genel renkler
    let tail = ours ? null : pick(OTHERS);
    if (!ours && this.others && this.others.length) {
      let r = Math.random() * (1 - this.share);
      for (const o of this.others) { r -= o.w; if (r < 0) { tail = o.color; break; } }
    }
    const p = { tail, scale: Math.random() < 0.18 ? 1.75 : 1.15, pos: { x: 0, y: 0 }, alt: 0, hdg: 0, ours };
    this.planes.push(p);
    return p;
  }

  park(st, pl, wait) {
    st.occ = pl; st.reserved = false;
    pl.pos = { ...st.c }; pl.alt = 0;
    pl.hdg = Math.atan2(st.dir.y, st.dir.x);
    pl.stand = st; pl.departIn = wait;
  }

  nearestTaxi(p, maxD = 700) {
    let best = null, bd = maxD;
    for (const t of this.taxi) { const d = dist(p, t); if (d < bd) { bd = d; best = t; } }
    return best || p;
  }

  runwayDir(r) {
    const [A, B] = this.wind > 0 ? [r.A, r.B] : [r.B, r.A];
    return { A, B, u: unit(sub(B, A)), L: r.L };
  }

  spawnLanding(progress = 0) {
    const free = this.stands.filter(s => !s.occ && !s.reserved);
    if (!free.length) return;
    const st = pick(free);
    st.reserved = true;
    const pl = this.newPlane(Math.random() < this.share);
    const { A, u, L } = this.runwayDir(pick(this.runways));
    const roll = Math.min(L - 300, 1800);
    const exit = add(A, u, roll);
    const path = [
      { p: add(A, u, -4500), alt: 240, v: 75 },
      { p: A, alt: 14, v: 72 },
      { p: add(A, u, 400), alt: 0, v: 66 },
      { p: exit, alt: 0, v: 14 },
      { p: this.nearestTaxi(add(exit, u, 120)), alt: 0, v: 10 },
      { p: this.nearestTaxi(add(st.c, st.dir, -70)), alt: 0, v: 10 },
      { p: add(st.c, st.dir, -45), alt: 0, v: 6 },
      { p: st.c, alt: 0, v: 1.5 },
    ];
    this.addMover(pl, path, () => this.park(st, pl, rnd(25, 80)), progress);
  }

  spawnTakeoff(st) {
    const pl = st.occ;
    st.occ = null;
    pl.stand = null;
    const { A, u } = this.runwayDir(pick(this.runways));
    const back = add(st.c, st.dir, -45);
    const path = [
      { p: st.c, alt: 0, v: 2, rev: true },
      { p: back, alt: 0, v: 5 },
      { p: this.nearestTaxi(add(back, st.dir, -40)), alt: 0, v: 10 },
      { p: this.nearestTaxi(add(A, u, 60)), alt: 0, v: 9 },
      { p: add(A, u, 60), alt: 0, v: 3 },
      { p: add(A, u, 1900), alt: 0, v: 82 },
      { p: add(A, u, 2700), alt: 60, v: 86 },
      { p: add(A, u, 9000), alt: 900, v: 95 },
    ];
    const m = this.addMover(pl, path, () => { this.planes.splice(this.planes.indexOf(pl), 1); });
    m.takeoff = true;
  }

  addMover(pl, path, done, progress = 0) {
    const m = { pl, path, seg: 0, s: 0, done };
    if (progress) m.s = dist(path[0].p, path[1].p) * progress;
    this.movers.push(m);
    this.place(m, 1);
    return m;
  }

  place(m, dt) {
    const a = m.path[m.seg], b = m.path[m.seg + 1];
    const L = dist(a.p, b.p) || 1, u = Math.min(1, m.s / L);
    m.pl.pos = { x: a.p.x + (b.p.x - a.p.x) * u, y: a.p.y + (b.p.y - a.p.y) * u };
    m.pl.alt = a.alt + (b.alt - a.alt) * u;
    let d = sub(b.p, a.p);
    if (a.rev) d = { x: -d.x, y: -d.y };
    if (len(d) > 0.5) {
      const target = Math.atan2(d.y, d.x);
      const diff = ((target - m.pl.hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      m.pl.hdg += diff * Math.min(1, dt * 4);
    }
  }

  tick(dt) {
    if (this.pendingBuild) {
      this.buildWait = (this.buildWait || 0) + dt;
      if (this.buildWait > 0.6) { this.buildWait = 0; this.tryBuild(); }
    }
    if (!this.built || !this.ap) return;
    dt *= TS;
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnLanding(); this.spawnT = this.interval * rnd(0.7, 1.3); }
    for (const st of this.stands) {
      const pl = st.occ;
      if (!pl) continue;
      pl.departIn -= dt;
      if (pl.departIn <= 0) {
        if (this.movers.filter(m => m.takeoff).length >= 2) { pl.departIn = 5; continue; }
        this.spawnTakeoff(st);
      }
    }
    for (const m of [...this.movers]) {
      const a = m.path[m.seg], b = m.path[m.seg + 1];
      const L = dist(a.p, b.p) || 1;
      m.s += Math.max(1, a.v + (b.v - a.v) * Math.min(1, m.s / L)) * dt;
      while (m.seg < m.path.length - 1) {
        const sl = dist(m.path[m.seg].p, m.path[m.seg + 1].p);
        if (m.s < sl) break;
        m.s -= sl; m.seg++;
      }
      if (m.seg >= m.path.length - 1) { this.movers.splice(this.movers.indexOf(m), 1); m.done(); continue; }
      this.place(m, dt);
    }
    this.draw();
  }

  draw(force) {
    const now = performance.now();
    if (!force && now - this.lastDraw < 50) return; // ~20 fps
    this.lastDraw = now;
    const feats = [];
    for (const pl of this.planes) {
      const c = Math.cos(pl.hdg), s = Math.sin(pl.hdg), k = pl.scale;
      for (const part of PARTS) {
        const ring = part.pts.map(([x, y]) => this.toLL({ x: pl.pos.x + (x * c - y * s) * k, y: pl.pos.y + (x * s + y * c) * k }));
        ring.push(ring[0]);
        feats.push({
          type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] },
          properties: {
            color: part.c === 'tail' ? (pl.ours ? this.livery.tail : pl.tail) : part.c === 'eng' ? ENG
              : pl.ours ? (part.h === 4 ? this.livery.body : this.livery.wing || BODY) : BODY,
            base: pl.alt + part.base * k, top: pl.alt + (part.base + part.h) * k,
          },
        });
      }
    }
    this.map.getSource('traffic3d')?.setData({ type: 'FeatureCollection', features: feats });
  }

  get info() {
    return this.ap && this.built ? { code: this.ap.c, stands: this.stands.length, parked: this.stands.filter(s => s.occ).length, moving: this.movers.length, runways: this.runways.length } : null;
  }
}

function closestOnSeg(p, a, b) {
  const ab = sub(b, a), l2 = ab.x * ab.x + ab.y * ab.y || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

function inside(p, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
}
