(() => {
'use strict';

// ---------- Ayarlar ----------
const PLANE_SPEED = 700;      // km / oyun saniyesi
const DWELL = 0.5;            // durakta bekleme (sn)
const WEEK_LEN = 40;          // bir hafta (sn)
const OVER_LIMIT = 25;        // taşma sayacı (sn)
const BASE_CAP = 8;           // havaalanı bekleme kapasitesi
const HUB_BONUS = 6;
const HIT_PX = 26;            // dokunma yarıçapı
const LINE_COLORS = ['#ffd166', '#06d6a0', '#4cc9f0', '#ef476f', '#f8961e', '#c77dff', '#90be6d', '#f9c6d0', '#e0e0e0', '#43aa8b'];
const R_EARTH = 6371;
const OFFSETS = [-360, 0, 360]; // tarih çizgisi için dünya kopyaları

const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;
const rand = (a, b) => a + Math.random() * (b - a);

function km(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

// İki nokta arası büyük daire yayı (boylamlar kesintisiz açılır).
function greatCircle(a, b) {
  const toV = p => { const la = rad(p.lat), lo = rad(p.lon); return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]; };
  const A = toV(a), B = toV(b);
  const dot = Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
  const om = Math.acos(dot);
  const dist = om * R_EARTH;
  const n = Math.max(2, Math.ceil(dist / 120));
  const pts = [];
  let prevLon = a.lon;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let v = A;
    if (om > 1e-6) {
      const s = Math.sin(om), k1 = Math.sin((1 - t) * om) / s, k2 = Math.sin(t * om) / s;
      v = [A[0] * k1 + B[0] * k2, A[1] * k1 + B[1] * k2, A[2] * k1 + B[2] * k2];
    }
    const lat = deg(Math.atan2(v[2], Math.hypot(v[0], v[1])));
    let lon = deg(Math.atan2(v[1], v[0]));
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    prevLon = lon;
    pts.push({ lon, lat });
  }
  pts[0] = { lon: a.lon, lat: a.lat };
  return { pts, km: dist };
}

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const canvas = $('map');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1, TOP = 0, BOTTOM = 0;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  TOP = $('topbar').offsetHeight + $('legend').offsetHeight + 8;
  BOTTOM = $('bottombar').offsetHeight;
}
window.addEventListener('resize', resize);

// ---------- Harita ----------
let landPath = null;
async function loadLand() {
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json');
    const topo = await res.json();
    const geo = topojson.feature(topo, topo.objects.land);
    const path = new Path2D();
    const addRing = ring => {
      if (ring.every(p => p[1] < -58)) return; // Antarktika'yı atla
      let prev = ring[0][0];
      ring.forEach((p, i) => {
        let lon = p[0];
        while (lon - prev > 180) lon -= 360;
        while (lon - prev < -180) lon += 360;
        prev = lon;
        if (i === 0) path.moveTo(lon, -p[1]); else path.lineTo(lon, -p[1]);
      });
      path.closePath();
    };
    const feats = geo.type === 'FeatureCollection' ? geo.features : [geo];
    feats.forEach(f => {
      const g = f.geometry; if (!g) return;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      polys.forEach(poly => poly.forEach(addRing));
    });
    landPath = path;
  } catch (e) {
    console.warn('Harita yüklenemedi:', e);
  }
}

// ---------- Oyun durumu ----------
let S;
const cam = { x: 20, y: -35, s: 6 };

function newGame() {
  S = {
    running: true, over: false, paused: false, speed: 1,
    time: 0, week: 1, weekT: 0,
    money: 200, delivered: 0,
    airports: [], pool: AIRPORTS.map(a => ({ ...a })),
    lines: [], planes: [],
    planesOwned: 3, capacity: 6, range: 4000,
    prices: { plane: 300, cap: 250, range: 200, hub: 150 },
    nextAirportT: 22, pendingHub: false,
  };
  START_AIRPORTS.forEach(code => openAirport(S.pool.find(a => a.code === code)));
  computeHops();
  fitCamera(0, true);
  updateHUD(); renderLines(); renderLegend();
}

function openAirport(ap) {
  S.pool.splice(S.pool.indexOf(ap), 1);
  Object.assign(ap, { queue: [], cap: BASE_CAP, over: 0, hub: false, born: S.time, spawnT: rand(2, 6), hop: {} });
  S.airports.push(ap);
}

function pickNextAirport() {
  if (!S.pool.length) return;
  const scored = S.pool.map(a => ({ a, d: Math.min(...S.airports.map(b => km(a, b))) }))
    .sort((x, y) => x.d - y.d);
  const pick = scored[Math.floor(Math.random() * Math.min(3, scored.length))].a;
  openAirport(pick);
  computeHops();
  renderLegend();
  toast(`Yeni havaalanı: ${pick.city} (${pick.code})`);
}

// Her havaalanından her bölgeye kaç aktarma uzakta olduğunu hesapla (BFS).
function computeHops() {
  const adj = new Map(S.airports.map(a => [a, new Set()]));
  S.lines.forEach(l => l.stops.forEach((s, i) => {
    if (i > 0) { adj.get(s).add(l.stops[i - 1]); adj.get(l.stops[i - 1]).add(s); }
  }));
  for (const r of Object.keys(REGIONS)) {
    S.airports.forEach(a => a.hop[r] = Infinity);
    const q = S.airports.filter(a => a.r === r);
    q.forEach(a => a.hop[r] = 0);
    for (let i = 0; i < q.length; i++) {
      const a = q[i];
      for (const b of adj.get(a)) if (b.hop[r] === Infinity) { b.hop[r] = a.hop[r] + 1; q.push(b); }
    }
  }
}

function spawnPassenger(ap) {
  const regions = [...new Set(S.airports.map(a => a.r))].filter(r => r !== ap.r);
  if (!regions.length) return;
  ap.queue.push({ r: regions[Math.floor(Math.random() * regions.length)], origin: ap });
}

// ---------- Rotalar ve uçaklar ----------
function buildLegs(stops) {
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) legs.push(greatCircle(stops[i], stops[i + 1]));
  return legs;
}

function createLine(stops) {
  const used = new Set(S.lines.map(l => l.color));
  const color = LINE_COLORS.find(c => !used.has(c)) || '#ffffff';
  const line = { color, stops, legs: buildLegs(stops) };
  line.km = line.legs.reduce((s, l) => s + l.km, 0);
  S.lines.push(line);
  const plane = { line, s: 0, n: 1, t: 0, dwell: DWELL, pax: [] };
  S.planes.push(plane);
  computeHops();
  exchange(plane, stops[0], stops[1]);
  renderLines();
  toast(`Rota açıldı: ${stops.map(s => s.code).join(' → ')}`);
}

function deleteLine(line) {
  S.planes.filter(p => p.line === line).forEach(p => {
    const dest = line.stops[p.n];
    p.pax.forEach(x => dest.queue.push(x));
  });
  S.planes = S.planes.filter(p => p.line !== line);
  S.lines = S.lines.filter(l => l !== line);
  computeHops();
  renderLines();
}

// Durakta yolcu indir/bindir. N = uçağın bir sonraki durağı.
function exchange(p, st, N) {
  const keep = [];
  for (const x of p.pax) {
    if (st.r === x.r) {
      const fare = Math.round(8 + km(x.origin, st) / 150);
      S.money += fare; S.delivered++;
    } else if (N.hop[x.r] < st.hop[x.r]) keep.push(x);
    else st.queue.push(x); // aktarma
  }
  p.pax = keep;
  const stay = [];
  for (const x of st.queue) {
    if (p.pax.length < S.capacity && N.hop[x.r] < st.hop[x.r]) p.pax.push(x);
    else stay.push(x);
  }
  st.queue = stay;
}

function updatePlane(p, dt) {
  if (p.dwell > 0) { p.dwell -= dt; return; }
  const leg = p.line.legs[Math.min(p.s, p.n)];
  p.t += dt * PLANE_SPEED / Math.max(leg.km, 200);
  if (p.t >= 1) {
    const stops = p.line.stops;
    const cur = p.n;
    let dir = p.n > p.s ? 1 : -1;
    let nxt = cur + dir;
    if (nxt < 0 || nxt >= stops.length) { dir = -dir; nxt = cur + dir; }
    p.s = cur; p.n = nxt; p.t = 0; p.dwell = DWELL;
    exchange(p, stops[cur], stops[nxt]);
    updateHUD();
  }
}

function planePos(p) {
  const leg = p.line.legs[Math.min(p.s, p.n)];
  const pts = leg.pts, m = pts.length - 1;
  const fwd = p.n > p.s;
  const f = (fwd ? p.t : 1 - p.t) * m;
  const i = Math.min(m - 1, Math.floor(f)), k = f - i;
  const a = pts[i], b = pts[i + 1];
  let ang = Math.atan2(-(b.lat - a.lat), b.lon - a.lon);
  if (!fwd) ang += Math.PI;
  return { lon: a.lon + (b.lon - a.lon) * k, lat: a.lat + (b.lat - a.lat) * k, ang };
}

// ---------- Döngü ----------
function update(dt) {
  S.time += dt;

  S.weekT += dt;
  if (S.weekT >= WEEK_LEN) {
    S.weekT -= WEEK_LEN; S.week++;
    const cost = Math.round(S.lines.reduce((s, l) => s + 20 + l.km / 150, 0));
    S.money -= cost;
    toast(`Hafta ${S.week} başladı · rota giderleri −$${cost}`);
  }

  S.nextAirportT -= dt;
  if (S.nextAirportT <= 0) {
    pickNextAirport();
    S.nextAirportT = Math.max(14, 24 - S.week);
  }

  const spawnEvery = Math.max(3.5, 10 - S.week * 0.6);
  for (const a of S.airports) {
    a.spawnT -= dt;
    if (a.spawnT <= 0) { spawnPassenger(a); a.spawnT = spawnEvery * rand(0.7, 1.3); }
    if (a.queue.length > a.cap) a.over += dt;
    else a.over = Math.max(0, a.over - dt * 0.5);
    if (a.over >= OVER_LIMIT) return gameOver(a);
  }

  S.planes.forEach(p => updatePlane(p, dt));
}

let last = performance.now();
let hudT = 0;
function frame(now) {
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S && S.running && !S.paused && !S.over) {
    update(real * S.speed);
    hudT += real;
    if (hudT > 0.25) { hudT = 0; updateHUD(); }
  }
  if (S) { fitCamera(real, false); draw(); }
  requestAnimationFrame(frame);
}

// ---------- Kamera ----------
function fitCamera(dt, instant) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const add = (lon, lat) => { minX = Math.min(minX, lon); maxX = Math.max(maxX, lon); minY = Math.min(minY, -lat); maxY = Math.max(maxY, -lat); };
  S.airports.forEach(a => add(a.lon, a.lat));
  S.lines.forEach(l => l.legs.forEach(g => { add(g.pts[0].lon, g.pts[0].lat); const e = g.pts[g.pts.length - 1]; add(e.lon, e.lat); }));
  const pad = 10;
  const spanX = Math.max(maxX - minX + pad * 2, 40);
  const spanY = Math.max(maxY - minY + pad * 2, 26);
  const availW = W - 16, availH = Math.max(100, H - TOP - BOTTOM);
  const ts = Math.min(availW / spanX, availH / spanY);
  const tx = (minX + maxX) / 2, ty = (minY + maxY) / 2;
  const k = instant ? 1 : 1 - Math.exp(-dt * 2.5);
  cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.s += (ts - cam.s) * k;
}
const centerY = () => TOP + (H - TOP - BOTTOM) / 2;
const sx = (lon, off = 0) => W / 2 + (lon + off - cam.x) * cam.s;
const sy = lat => centerY() + (-lat - cam.y) * cam.s;

// ---------- Çizim ----------
function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#0b1626';
  ctx.fillRect(0, 0, W, H);

  // Enlem/boylam ızgarası
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let lon = -540; lon <= 540; lon += 30) { const x = sx(lon); if (x > -1 && x < W + 1) { ctx.moveTo(x, 0); ctx.lineTo(x, H); } }
  for (let lat = -60; lat <= 80; lat += 30) { const y = sy(lat); ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  // Kara
  if (landPath) {
    for (const off of OFFSETS) {
      ctx.setTransform(DPR * cam.s, 0, 0, DPR * cam.s, DPR * (W / 2 + (off - cam.x) * cam.s), DPR * (centerY() - cam.y * cam.s));
      ctx.fillStyle = '#1a2a40';
      ctx.fill(landPath, 'evenodd');
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  // Rotalar
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const l of S.lines) {
    ctx.strokeStyle = l.color; ctx.lineWidth = 4;
    for (const off of OFFSETS) {
      ctx.beginPath();
      for (const g of l.legs) g.pts.forEach((p, i) => i ? ctx.lineTo(sx(p.lon, off), sy(p.lat)) : ctx.moveTo(sx(p.lon, off), sy(p.lat)));
      ctx.stroke();
    }
  }

  // Taslak rota
  if (draft) drawDraft();

  // Havaalanları
  for (const a of S.airports) for (const off of OFFSETS) {
    const x = sx(a.lon, off), y = sy(a.lat);
    if (x < -60 || x > W + 60) continue;
    drawAirport(a, x, y);
  }

  // Uçaklar
  for (const p of S.planes) {
    const pos = planePos(p);
    for (const off of OFFSETS) {
      const x = sx(pos.lon, off), y = sy(pos.lat);
      if (x < -30 || x > W + 30) continue;
      drawPlane(p, x, y, pos.ang);
    }
  }
}

function drawAirport(a, x, y) {
  const age = S.time - a.born;
  const pop = age < 0.6 ? 0.4 + age : 1;
  const r = (a.hub ? 9 : 7) * pop;

  if (a.over > 0) {
    ctx.strokeStyle = 'rgba(239,71,111,0.25)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, r + 8, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ef476f';
    ctx.beginPath(); ctx.arc(x, y, r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (a.over / OVER_LIMIT)); ctx.stroke();
  }
  if (S.pendingHub) {
    ctx.strokeStyle = 'rgba(255,209,102,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r + 5 + Math.sin(S.time * 6) * 2, 0, Math.PI * 2); ctx.stroke();
  }

  ctx.fillStyle = '#e9eef5';
  ctx.strokeStyle = REGIONS[a.r].color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (a.hub) { ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r - 4, 0, Math.PI * 2); ctx.stroke(); }

  ctx.fillStyle = 'rgba(233,238,245,0.8)';
  ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(a.code, x, y + r + 4);

  // Bekleyen yolcular
  const n = Math.min(a.queue.length, a.cap + 6);
  for (let i = 0; i < n; i++) {
    const col = i % 6, row = Math.floor(i / 6);
    ctx.fillStyle = REGIONS[a.queue[i].r].color;
    ctx.beginPath(); ctx.arc(x + r + 7 + col * 7, y - 4 + row * 7, 2.6, 0, Math.PI * 2); ctx.fill();
  }
}

function drawPlane(p, x, y, ang) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = p.line.color;
  ctx.strokeStyle = '#0b1626'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(9, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
  if (p.pax.length) {
    ctx.fillStyle = '#e9eef5'; ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(p.pax.length, x, y - 8);
  }
}

function drawDraft() {
  const st = draft.stops;
  const color = LINE_COLORS.find(c => !S.lines.some(l => l.color === c)) || '#fff';
  ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.globalAlpha = 0.85;
  for (let i = 0; i < st.length - 1; i++) {
    const g = greatCircle(st[i], st[i + 1]);
    for (const off of OFFSETS) {
      ctx.beginPath();
      g.pts.forEach((p, j) => j ? ctx.lineTo(sx(p.lon, off), sy(p.lat)) : ctx.moveTo(sx(p.lon, off), sy(p.lat)));
      ctx.stroke();
    }
  }
  const lastAp = st[st.length - 1];
  const fromX = nearestCopyX(lastAp, draft.x), fromY = sy(lastAp.lat);
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = draft.err ? '#ef476f' : color;
  ctx.beginPath(); ctx.moveTo(fromX, fromY); ctx.lineTo(draft.x, draft.y); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  if (draft.err) {
    const msg = `Menzil dışı: ${Math.round(draft.err.d)} km > ${S.range} km`;
    ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const w = ctx.measureText(msg).width + 16;
    const tx = Math.min(W - w / 2 - 8, Math.max(w / 2 + 8, draft.x));
    ctx.fillStyle = 'rgba(18,35,58,0.95)';
    ctx.fillRect(tx - w / 2, draft.y - 58, w, 24);
    ctx.fillStyle = '#ef476f'; ctx.fillText(msg, tx, draft.y - 39);
  }
}

function nearestCopyX(a, nearX) {
  let best = sx(a.lon), bd = Infinity;
  for (const off of OFFSETS) { const x = sx(a.lon, off); const d = Math.abs(x - nearX); if (d < bd) { bd = d; best = x; } }
  return best;
}

// ---------- Dokunma / fare ----------
let pointer = null, draft = null;

function hitAirport(x, y) {
  let best = null, bd = HIT_PX;
  for (const a of S.airports) for (const off of OFFSETS) {
    const d = Math.hypot(sx(a.lon, off) - x, sy(a.lat) - y);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

canvas.addEventListener('pointerdown', e => {
  if (!S || !S.running || S.over || pointer) return;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* sentetik olaylar */ }
  const ap = hitAirport(e.clientX, e.clientY);
  pointer = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ap };
  if (ap && !S.pendingHub) draft = { stops: [ap], x: e.clientX, y: e.clientY, err: null };
});

canvas.addEventListener('pointermove', e => {
  if (!pointer || e.pointerId !== pointer.id) return;
  if (Math.hypot(e.clientX - pointer.x0, e.clientY - pointer.y0) > 8) pointer.moved = true;
  if (!draft) return;
  draft.x = e.clientX; draft.y = e.clientY; draft.err = null;
  const st = draft.stops, lastAp = st[st.length - 1];
  const ap = hitAirport(e.clientX, e.clientY);
  if (ap && ap !== lastAp) {
    if (st.length >= 2 && ap === st[st.length - 2]) st.pop();
    else if (!st.includes(ap)) {
      const d = km(lastAp, ap);
      if (d <= S.range) st.push(ap); else draft.err = { ap, d };
    }
  }
});

function endPointer(e) {
  if (!pointer || e.pointerId !== pointer.id) return;
  const p = pointer; pointer = null;
  const d = draft; draft = null;
  if (S.over) return;
  if (!p.moved) { if (p.ap) tapAirport(p.ap); return; }
  if (d && d.stops.length >= 2) {
    if (S.lines.length >= S.planesOwned) toast('Boş uçak yok. Dükkândan yeni uçak al.');
    else createLine(d.stops);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', e => { if (pointer && e.pointerId === pointer.id) { pointer = null; draft = null; } });

function tapAirport(a) {
  if (S.pendingHub) {
    if (a.hub) return toast(`${a.city} zaten hub.`);
    if (S.money < S.prices.hub) { S.pendingHub = false; return toast('Yetersiz bakiye.'); }
    S.money -= S.prices.hub; S.prices.hub += 50;
    a.hub = true; a.cap += HUB_BONUS; S.pendingHub = false;
    updateHUD();
    return toast(`${a.city} artık hub! Kapasite ${a.cap}`);
  }
  toast(`${a.city} (${a.code}) · ${REGIONS[a.r].name} · bekleyen ${a.queue.length}/${a.cap}`);
}

// ---------- Arayüz ----------
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function updateHUD() {
  const m = $('money');
  m.textContent = (S.money < 0 ? '−$' : '$') + Math.abs(Math.round(S.money));
  m.classList.toggle('neg', S.money < 0);
  $('week').textContent = S.week;
  $('weekfill').style.width = (S.weekT / WEEK_LEN * 100) + '%';
  $('delivered').textContent = S.delivered;
}

function renderLegend() {
  const regions = [...new Set(S.airports.map(a => a.r))];
  $('legend').innerHTML = regions.map(r => `<span><i style="background:${REGIONS[r].color}"></i>${REGIONS[r].name}</span>`).join('');
  resize();
}

function renderLines() {
  const box = $('lines');
  box.innerHTML = '';
  S.lines.forEach(l => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `<i style="background:${l.color}"></i>${l.stops[0].code}–${l.stops[l.stops.length - 1].code}`;
    b.onclick = () => askDelete(l);
    box.appendChild(b);
  });
  for (let i = S.lines.length; i < S.planesOwned; i++) {
    const s = document.createElement('div');
    s.className = 'chip empty'; s.textContent = '✈ boş uçak';
    box.appendChild(s);
  }
}

let pendingDelete = null;
function askDelete(l) {
  pendingDelete = l;
  $('confirmText').textContent = `${l.stops.map(s => s.code).join(' → ')} rotası silinsin mi? Uçaktaki yolcular sonraki durağa indirilir.`;
  show('confirm');
}
$('btnConfirmNo').onclick = () => { pendingDelete = null; hide('confirm'); };
$('btnConfirmYes').onclick = () => { if (pendingDelete) deleteLine(pendingDelete); pendingDelete = null; hide('confirm'); };

const SHOP = [
  { id: 'plane', name: 'Yeni uçak', desc: () => 'Bir rota daha açabilirsin', buy: () => { S.planesOwned++; S.prices.plane += 150; renderLines(); } },
  { id: 'cap', name: 'Daha büyük kabin', desc: () => `Tüm uçaklar ${S.capacity} → ${S.capacity + 2} koltuk`, buy: () => { S.capacity += 2; S.prices.cap += 150; } },
  { id: 'range', name: 'Menzil yükseltmesi', desc: () => `${S.range} → ${S.range + 1500} km`, buy: () => { S.range += 1500; S.prices.range += 200; } },
  { id: 'hub', name: 'Hub kur', desc: () => `Bir havaalanına +${HUB_BONUS} bekleme kapasitesi (dokunarak seç)`, buy: null },
];

function renderShop() {
  $('shopItems').innerHTML = '';
  SHOP.forEach(item => {
    const price = S.prices[item.id];
    const row = document.createElement('div');
    row.className = 'shop-item';
    row.innerHTML = `<div class="info"><b>${item.name}</b><small>${item.desc()}</small></div>`;
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = '$' + price;
    btn.disabled = S.money < price;
    btn.onclick = () => {
      if (S.money < price) return;
      if (item.id === 'hub') {
        S.pendingHub = true; closeShop();
        return toast('Hub yapmak istediğin havaalanına dokun.');
      }
      S.money -= price; item.buy(); updateHUD(); renderShop();
      toast(`${item.name} alındı.`);
    };
    row.appendChild(btn);
    $('shopItems').appendChild(row);
  });
}

let pausedBeforeShop = false;
function openShop() { pausedBeforeShop = S.paused; S.paused = true; renderShop(); show('shop'); }
function closeShop() { S.paused = pausedBeforeShop; hide('shop'); updatePauseBtn(); }
$('btnShop').onclick = () => { if (S && S.running && !S.over) openShop(); };
$('btnShopClose').onclick = closeShop;

function updatePauseBtn() { $('btnPause').textContent = S.paused ? '▶' : '❚❚'; }
$('btnPause').onclick = () => { S.paused = !S.paused; updatePauseBtn(); };
$('btnSpeed').onclick = () => { S.speed = S.speed >= 3 ? 1 : S.speed + 1; $('btnSpeed').textContent = S.speed + '×'; };

document.addEventListener('visibilitychange', () => {
  if (document.hidden && S && S.running && !S.over) { S.paused = true; updatePauseBtn(); }
});

function show(id) { $(id).classList.add('show'); }
function hide(id) { $(id).classList.remove('show'); }

function gameOver(a) {
  S.over = true;
  updateHUD();
  $('goText').innerHTML = `<b>${a.city}</b> havaalanı taştı.<br><br>Hafta: <b>${S.week}</b><br>Taşınan yolcu: <b>${S.delivered}</b><br>Havaalanı sayısı: <b>${S.airports.length}</b>`;
  show('gameover');
}

$('btnStart').onclick = () => { hide('start'); resize(); newGame(); };
$('btnRestart').onclick = () => {
  hide('gameover'); S.speed = 1; $('btnSpeed').textContent = '1×';
  newGame(); updatePauseBtn();
};

// ---------- Başlat ----------
resize();
loadLand();
newGame();
S.running = false; // başlangıç ekranının arkasında harita görünsün
requestAnimationFrame(frame);

// Test için: ?debug ile açınca konsoldan erişilebilir.
if (location.search.includes('debug')) window.SKY = { state: () => S, step: dt => { update(dt); updateHUD(); draw(); } };
})();
