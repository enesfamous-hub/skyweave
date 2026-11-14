// Oyun döngüsü, arayüz ve kayıt.
import { Globe } from './globe.js';
import { AirportTraffic } from './traffic3d.js?v=10';
import { AIRPORTS, AIRCRAFT, TIERS, ZONES } from './data.js';
import * as sim from './sim.js';
import { spawnRivals, weeklyRivals, rivalFlightsAt } from './rivals.js';
import { dailyEvents, decisionView, decide, describeEvent } from './events.js';
import * as P from './progress.js';

const { AP, AC } = sim;
const SAVE_KEY = 'skyweave-save-v2';
const ROUTE_COLORS = ['#ffd166', '#06d6a0', '#4cc9f0', '#ef476f', '#f8961e', '#c77dff', '#90be6d', '#ff99c8', '#a0c4ff', '#fdffb6', '#9bf6ff', '#ffadad'];
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const DAY_OFFSET = 15; // gün sonu: 00:00 TSİ (oyun t=0 → 09:00 TSİ)
const $ = id => document.getElementById(id);

const globe = new Globe($('globe'), { onAirportClick: code => onAirportTap(AP[code]) });

// Havalimanında 3B uçaklar: senin uçaklarının sayısı ve trafikteki payın
function shareFor(code) {
  if (!S) return { ours: 0, share: 0 };
  const ap = AP[code];
  const routes = S.routes.filter(r => r.a === code || r.b === code);
  let ours = 0, flights = 0;
  for (const r of routes) {
    const d = sim.distKm(AP[r.a], AP[r.b]);
    for (const id of r.planes) { const f = fleetById(id); if (f) { ours++; flights += 2 * sim.rtPerDay(d, AC[f.type]); } }
  }
  const others = rivalFlightsAt(S, code);
  const rivalF = others.reduce((s, o) => s + o.flights, 0);
  const total = flights + rivalF + ap.p * 25;
  return { ours, share: flights ? Math.min(0.85, flights / total) : 0, others: others.map(o => ({ color: o.color, w: o.flights / total })) };
}
const traffic = new AirportTraffic(globe.map, { airports: AIRPORTS, shareFor });
globe.map.on('style.load', () => traffic.attach());

let S = null;           // oyun durumu (kaydedilen)
let speed = 1;
let panel = null;       // açık alt sayfa
let selRoute = null, selAirport = null;
let pickFrom = null;    // rota açarken seçilen ilk havaalanı

// ---------- Biçimlendirme ----------
const money = n => {
  const s = n < 0 ? '−' : ''; n = Math.abs(n);
  if (n >= 1e9) return `${s}$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${s}$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${s}$${Math.round(n / 1e3)}K`;
  return `${s}$${Math.round(n)}`;
};
const num = n => Math.round(n).toLocaleString('tr-TR');
const pct = x => Math.round(x * 100) + '%';
const sign = n => n >= 0 ? 'pos' : 'neg';
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const doyNow = () => sim.dayOfYear(sim.gameDate(S.t));
const tier = () => sim.tierOf(S);
const fleetById = id => S.fleet.find(f => f.id === id);

// ---------- Durum ve kayıt ----------
function newState(name, base, legacy = null) {
  return { v: 2, name, t: 0, day: 0, cash: 15e6, tier: 1, bases: [base], fleet: [], routes: [], totalPax: 0, history: [], seq: 1, regSeq: 0, over: false, rivals: [], news: [], events: [], newsSeen: 0,
    upgrades: {}, managers: {}, goalsDone: [], goalsNotified: [], legacy, lastSeen: Date.now(), cashBonus: 0 };
}
function save() { try { if (S) S.lastSeen = Date.now(); localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (_) { /* depolama yok */ } }
function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.v === 2 && !s.over ? s : null; } catch (_) { return null; }
}
function nextReg() {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', i = S.regSeq++;
  return `TC-S${L[Math.floor(i / 26) % 26]}${L[i % 26]}`;
}

// ---------- Havaalanı işaretleri (harita katmanı) ----------
let apKey = '';
function updateMarkers() {
  const zones = S ? tier().zones : ['TR'];
  const key = S ? [S.tier, S.bases.join(), S.routes.map(r => r.a + r.b).join(), pickFrom?.c, selAirport?.c].join('|') : 'none';
  if (key === apKey) return;
  apKey = key;
  const net = new Set();
  if (S) S.routes.forEach(r => { net.add(r.a); net.add(r.b); });
  globe.setAirports(AIRPORTS.map(ap => {
    const base = S && S.bases.includes(ap.c);
    const st = base ? 'base' : net.has(ap.c) ? 'net' : !zones.includes(ap.z) ? 'locked' : 'normal';
    let tgt = 0;
    if (pickFrom && ap !== pickFrom) tgt = sim.routeBlocker(S, pickFrom, ap) ? 2 : 1;
    const sort = (base ? 0 : st === 'net' ? 100 : tgt === 1 ? 200 : 300) - ap.p;
    return { code: ap.c, name: ap.n, lat: ap.lat, lon: ap.lon, st, tgt, pop: ap.p, sel: ap === pickFrom || ap === selAirport, sort };
  }));
}

// ---------- Küre senkronu ----------
function syncGlobe() {
  if (!S) { globe.setRoutes([]); globe.setPlanes([]); globe.setRivalRoutes([]); return; }
  globe.setRoutes(S.routes.map(r => ({ id: r.id, a: AP[r.a], b: AP[r.b], color: r.color, km: sim.distKm(AP[r.a], AP[r.b]) })), selRoute);
  const planes = [];
  for (const r of S.routes) {
    const a = AP[r.a], b = AP[r.b], km = sim.distKm(a, b);
    r.planes.forEach((id, i) => {
      const f = fleetById(id); if (!f) return;
      const ac = AC[f.type], rt = sim.rtHours(km, ac);
      planes.push({ a, b, km, color: r.color, rt, dwell: ac.turn / (rt / 2), phase: i / r.planes.length });
    });
  }
  globe.setPlanes(planes);
  globe.setRivalRoutes((S.rivals || []).filter(rv => rv.active).flatMap(rv => rv.routes.map(rr => ({ a: AP[rr.a], b: AP[rr.b], color: rv.color }))));
  syncEventMarkers();
  if (!pickFrom) globe.setPreview(null);
}

function syncEventMarkers() {
  if (!S) { globe.setEvents([]); return; }
  const list = [];
  for (const e of sim.activeEvents(S)) {
    if (!e.airports) continue;
    const color = (e.dem ?? 1) > 1 ? '#06a77d' : '#e85d04';
    for (const c of e.airports) list.push({ lat: AP[c].lat, lon: AP[c].lon, label: e.label || e.title, color });
  }
  globe.setEvents(list);
}

// Bir rotayı etkileyen süren olaylar (uyarı satırları)
function routeEventWarnings(r) {
  const out = [];
  for (const e of sim.activeEvents(S)) {
    const hitsA = e.airports ? e.airports.includes(r.a) : null, hitsB = e.airports ? e.airports.includes(r.b) : null;
    const relevant = e.global || e.strike || (e.grounded && r.planes.some(id => fleetById(id)?.type === e.grounded))
      || hitsA || hitsB || (e.country && (AP[r.a].co === e.country || AP[r.b].co === e.country))
      || (e.tourist && (AP[r.a].t >= 0.5 || AP[r.b].t >= 0.5)) || e.rep;
    if (!relevant) continue;
    const d = describeEvent(e);
    out.push(`<p class="${(e.dem ?? 1) > 1 || (e.rep ?? 1) > 1 || (e.fuel ?? 1) < 1 ? 'warn' : 'err'}" style="margin-top:8px"><b>${e.title}</b>${d.where ? ' · ' + d.where : ''}: ${d.effect} (${e.until - S.day} gün)</p>`);
  }
  return out.join('');
}

// ---------- Alt sayfa ----------
function openSheet(name, render) {
  panel = { name, render };
  refreshSheet();
  $('sheet').classList.add('open');
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.panel === name));
}
function refreshSheet() {
  if (!panel) return;
  const sh = $('sheet'), top = sh.scrollTop;
  $('sheetBody').innerHTML = '';
  panel.render($('sheetBody'));
  sh.scrollTop = top;
}
function hideSheet() {
  panel = null;
  $('sheet').classList.remove('open');
  document.querySelectorAll('#nav button').forEach(b => b.classList.remove('on'));
}
function closeSheet() {
  hideSheet();
  const had = selRoute || pickFrom;
  selRoute = null; selAirport = null; pickFrom = null;
  globe.setPreview(null);
  if (had) syncGlobe();
}
$('sheetClose').onclick = closeSheet;

function bind(root, sel, fn, ev = 'click') { root.querySelectorAll(sel).forEach(el => el.addEventListener(ev, e => fn(el, e))); }

// ---------- Havaalanı ----------
function onAirportTap(ap) {
  if (!S || S.over) return;
  if (pickFrom) {
    if (ap === pickFrom) { cancelPick(); return; }
    openPlanner(pickFrom, ap);
    return;
  }
  openAirport(ap);
}

function openAirport(ap) {
  selAirport = ap; selRoute = null;
  openSheet('airport', body => {
    const locked = !tier().zones.includes(ap.z);
    const base = S.bases.includes(ap.c);
    const routes = S.routes.filter(r => r.a === ap.c || r.b === ap.c);
    const season = sim.seasonFactor(ap, doyNow());
    body.innerHTML = `
      <h3>${ap.n}<small>${ap.c}</small></h3>
      <div class="meta">${ZONES[ap.z]} · ${ap.co} · nüfus ${ap.p} milyon${ap.t >= 0.5 ? ' · turistik' : ''}</div>
      ${locked ? `<p class="warn">Buraya uçmak için <b>${sim.tierForZone(ap.z).name}</b> lisansı gerekir.</p>` : ''}
      ${base ? '<p class="warn">★ Burası senin üssün. Rotalar üslerinden başlar.</p>' : ''}
      <div class="grid2">
        <div class="kv"><div class="k">Bugünkü sezon etkisi</div><div class="v ${sign(season - 1)}">${season >= 1 ? '+' : ''}${Math.round((season - 1) * 100)}%</div></div>
        <div class="kv"><div class="k">Buradaki rotaların</div><div class="v">${routes.length}</div></div>
      </div>
      ${routes.length ? '<h4>Rotalar</h4><div class="list" id="apRoutes"></div>' : ''}
      ${rivalsHere(ap)}
      <div class="row" id="apActions"></div>`;
    if (routes.length) routeList(body.querySelector('#apRoutes'), routes);
    const act = body.querySelector('#apActions');
    const view = document.createElement('button');
    view.textContent = 'Havalimanına yakınlaş';
    view.onclick = () => zoomToAirport(ap);
    act.appendChild(view);
    if (!locked) {
      const b = document.createElement('button');
      b.className = 'primary'; b.textContent = base ? 'Buradan rota aç' : 'Buraya rota aç';
      b.onclick = () => startPick(ap);
      act.appendChild(b);
      if (!base) {
        const bb = document.createElement('button');
        bb.textContent = `Üs kur (${money(sim.BASE_COST)})`;
        bb.disabled = S.cash < sim.BASE_COST;
        bb.onclick = () => {
          if (S.cash < sim.BASE_COST) return;
          S.cash -= sim.BASE_COST; S.bases.push(ap.c);
          toast(`${ap.n} artık üssün!`); save(); refreshSheet();
        };
        act.appendChild(bb);
      }
    }
  });
}

// ---------- Havalimanına yakınlaş ----------
function zoomToAirport(ap) {
  hideSheet();
  globe.flyTo(ap.lat, ap.lon, 14.2);
}

// ---------- Rota açma ----------
function startPick(ap) {
  pickFrom = ap; selAirport = null;
  hideSheet();
  updateHint(true);
}
function cancelPick() {
  pickFrom = null; globe.setPreview(null); updateHint(true);
}

function openPlanner(a, b) {
  const chosen = new Set();
  let fareMul = 1;
  openSheet('planner', body => {
    const block = sim.routeBlocker(S, a, b);
    globe.setPreview(a, b, !block);
    const d = sim.distKm(a, b);
    const doy = doyNow();
    body.innerHTML = `
      <h3>${a.c} → ${b.c}</h3>
      <div class="meta">${a.n} – ${b.n} · ${num(d)} km</div>
      ${block ? `<p class="err">${block}</p><div class="row"><button id="pkBack">Başka havaalanı seç</button></div>` : `
      <div class="grid2">
        <div class="kv"><div class="k">Günlük talep (yön başına)</div><div class="v">${num(sim.demandPerDir(a, b, doy, 1))}</div></div>
        <div class="kv"><div class="k">Normal bilet</div><div class="v">${money(sim.baseFare(d))}</div></div>
      </div>
      <h4>Uçak seç</h4><div class="list" id="pkPlanes"></div>
      <h4>Bilet fiyatı: <span id="pkFareLbl"></span></h4>
      <input type="range" class="slider" id="pkFare" min="60" max="160" step="5" value="${fareMul * 100}">
      <div id="pkEst"></div>
      <div class="row"><button id="pkCancel" class="ghost">Vazgeç</button><button id="pkOpen" class="primary">Rotayı aç</button></div>`}`;
    if (block) { body.querySelector('#pkBack').onclick = () => { hideSheet(); globe.setPreview(null); updateHint(true); }; return; }

    const idle = S.fleet.filter(f => !f.route);
    const list = body.querySelector('#pkPlanes');
    if (!idle.length) {
      list.innerHTML = `<p class="warn">Boşta uçağın yok. Önce filona uçak ekle.</p><button id="pkMarket">Uçak pazarına git</button>`;
      list.querySelector('#pkMarket').onclick = () => { pickFrom = null; globe.setPreview(null); openMarket(); };
    }
    for (const f of idle) {
      const ac = AC[f.type], ok = ac.range >= d;
      const row = document.createElement('label');
      row.className = 'item check' + (ok ? '' : ' locked-item');
      row.innerHTML = `<input type="checkbox" ${ok ? '' : 'disabled'} ${chosen.has(f.id) ? 'checked' : ''}>
        <div class="grow"><div class="t">${ac.name} <span class="s">${f.reg}</span></div>
        <div class="s">${ok ? `${ac.seats} koltuk · günde ${sim.rtPerDay(d, ac).toFixed(1)} gidiş-dönüş` : `Menzil yetmez (${num(ac.range)} km)`}</div></div>`;
      row.querySelector('input').onchange = e => { e.target.checked ? chosen.add(f.id) : chosen.delete(f.id); est(); };
      list.appendChild(row);
    }
    const est = () => {
      body.querySelector('#pkFareLbl').textContent = `${money(sim.baseFare(d) * fareMul)} (${pct(fareMul)})`;
      const e = sim.routeEcon({ a: a.c, b: b.c, fareMul, planes: [...chosen] }, S.fleet, doy, true, S);
      body.querySelector('#pkEst').innerHTML = (chosen.size ? `
        <div class="grid2" style="margin-top:8px">
          <div class="kv"><div class="k">Beklenen doluluk</div><div class="v">${pct(e.load)}</div></div>
          <div class="kv"><div class="k">Günlük kâr (kira dahil)</div><div class="v ${sign(e.net)}">${money(e.net)}</div></div>
          <div class="kv"><div class="k">Beklenen pazar payın</div><div class="v">${pct(e.share)}</div></div>
        </div>
        <p class="meta" style="margin-top:8px">Yeni rotada talep %40'tan başlar, 30 günde tam seviyeye çıkar.</p>` : '') + compList(e.comps);
      body.querySelector('#pkOpen').disabled = !chosen.size;
    };
    body.querySelector('#pkFare').oninput = e => { fareMul = e.target.value / 100; est(); };
    body.querySelector('#pkCancel').onclick = () => { closeSheet(); };
    body.querySelector('#pkOpen').onclick = () => createRoute(a, b, [...chosen], fareMul);
    est();
  });
}

function addRoute(a, b, planeIds, fareMul = 1) {
  const used = new Set(S.routes.map(r => r.color));
  const color = ROUTE_COLORS.find(c => !used.has(c)) || ROUTE_COLORS[S.routes.length % ROUTE_COLORS.length];
  const r = { id: 'R' + S.seq++, a: a.c, b: b.c, fareMul, planes: planeIds, color, age: 0, last: null };
  planeIds.forEach(id => { fleetById(id).route = r.id; });
  S.routes.push(r);
  return r;
}

function createRoute(a, b, planeIds, fareMul) {
  const used = new Set(S.routes.map(r => r.color));
  const color = ROUTE_COLORS.find(c => !used.has(c)) || ROUTE_COLORS[S.routes.length % ROUTE_COLORS.length];
  const r = { id: 'R' + S.seq++, a: a.c, b: b.c, fareMul, planes: planeIds, color, age: 0, last: null };
  planeIds.forEach(id => { fleetById(id).route = r.id; });
  S.routes.push(r);
  pickFrom = null;
  globe.setPreview(null);
  save();
  toast(`Rota açıldı: ${a.n} ⇄ ${b.n}`);
  openRoute(r);
}

// ---------- Rota detayı ----------
function routeList(el, routes) {
  for (const r of routes) {
    const a = AP[r.a], b = AP[r.b];
    const net = r.last ? r.last.net : null;
    const btn = document.createElement('button');
    btn.className = 'item';
    btn.innerHTML = `<span class="swatch" style="background:${r.color}"></span>
      <div class="grow"><div class="t">${a.c} ⇄ ${b.c}</div><div class="s">${a.n} – ${b.n} · ${r.planes.length} uçak${r.last ? ' · doluluk ' + pct(r.last.load) : ''}</div></div>
      <div class="r ${net == null ? '' : sign(net)}">${net == null ? 'yeni' : money(net) + '/gün'}</div>`;
    btn.onclick = () => openRoute(r);
    el.appendChild(btn);
  }
}

function openRoute(r) {
  selRoute = r.id; selAirport = null;
  syncGlobe();
  openSheet('route', body => {
    if (!S.routes.includes(r)) return closeSheet();
    const a = AP[r.a], b = AP[r.b], d = sim.distKm(a, b);
    body.innerHTML = `
      <h3><span class="swatch" style="display:inline-block;background:${r.color};margin-right:8px"></span>${a.c} ⇄ ${b.c}</h3>
      <div class="meta">${a.n} – ${b.n} · ${num(d)} km · ${r.age} günlük rota</div>
      <div id="rtStats"></div>
      <h4>Bilet fiyatı: <span id="rtFareLbl"></span></h4>
      <input type="range" class="slider" id="rtFare" min="60" max="160" step="5" value="${Math.round(r.fareMul * 100)}">
      <h4>Bu rotadaki uçaklar</h4><div class="list" id="rtPlanes"></div>
      <h4>Boştaki uçaklar</h4><div class="list" id="rtIdle"></div>
      <div class="row"><button id="rtClose" class="danger">Rotayı kapat</button></div>`;
    const stats = () => {
      const e = sim.routeEcon(r, S.fleet, doyNow(), false, S);
      body.querySelector('#rtFareLbl').textContent = `${money(e.fare)} (${pct(r.fareMul)})`;
      body.querySelector('#rtStats').innerHTML = `
        <div class="grid2">
          <div class="kv"><div class="k">Doluluk</div><div class="v">${pct(e.load)}</div></div>
          <div class="kv"><div class="k">Günlük yolcu</div><div class="v">${num(2 * e.pax)}</div></div>
          <div class="kv"><div class="k">Talep / koltuk (yön)</div><div class="v">${num(e.demand)} / ${num(e.seats)}</div></div>
          <div class="kv"><div class="k">Günlük kâr (kira dahil)</div><div class="v ${sign(e.net)}">${money(e.net)}</div></div>
          ${e.comps.length ? `<div class="kv"><div class="k">Pazar payın</div><div class="v">${pct(e.share)}</div></div>` : ''}
        </div>
        ${routeEventWarnings(r)}
        ${compList(e.comps)}
        ${sim.rampP(S, r.age) < 1 ? `<p class="meta" style="margin-top:8px">Rota yeni: talep şu an tam seviyenin %${Math.round(100 * sim.rampP(S, r.age))}'ında.</p>` : ''}
        ${e.load > 0.98 && e.demand > e.seats * 1.2 ? '<p class="warn">Talep koltuktan fazla: uçak ekle ya da bilet fiyatını artır.</p>' : ''}
        ${e.load < 0.6 && r.planes.length ? '<p class="warn">Doluluk düşük: fiyatı indir ya da bir uçağı başka rotaya al.</p>' : ''}`;
    };
    body.querySelector('#rtFare').oninput = e => { r.fareMul = e.target.value / 100; stats(); };
    body.querySelector('#rtFare').onchange = () => save();

    const pl = body.querySelector('#rtPlanes');
    if (!r.planes.length) pl.innerHTML = '<p class="warn">Bu rotada uçak yok, sefer yapılmıyor.</p>';
    for (const id of r.planes) {
      const f = fleetById(id), ac = AC[f.type];
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `<div class="grow"><div class="t">${ac.name}</div><div class="s">${f.reg} · günde ${sim.rtPerDay(d, ac).toFixed(1)} gidiş-dönüş</div></div><button class="sm">Çıkar</button>`;
      row.querySelector('button').onclick = () => { r.planes = r.planes.filter(x => x !== id); f.route = null; save(); syncGlobe(); refreshSheet(); };
      pl.appendChild(row);
    }
    const idle = S.fleet.filter(f => !f.route);
    const il = body.querySelector('#rtIdle');
    if (!idle.length) il.innerHTML = '<p class="meta">Boşta uçak yok. Filo menüsünden yeni uçak alabilirsin.</p>';
    for (const f of idle) {
      const ac = AC[f.type], ok = ac.range >= d;
      const row = document.createElement('div');
      row.className = 'item' + (ok ? '' : ' locked-item');
      row.innerHTML = `<div class="grow"><div class="t">${ac.name}</div><div class="s">${f.reg} · ${ok ? ac.seats + ' koltuk' : 'menzil yetmez'}</div></div><button class="sm" ${ok ? '' : 'disabled'}>Ekle</button>`;
      row.querySelector('button').onclick = () => { r.planes.push(f.id); f.route = r.id; save(); syncGlobe(); refreshSheet(); };
      il.appendChild(row);
    }
    body.querySelector('#rtClose').onclick = () => {
      if (!confirm(`${a.n} ⇄ ${b.n} rotası kapatılsın mı? Uçaklar boşa çıkar.`)) return;
      r.planes.forEach(id => { fleetById(id).route = null; });
      S.routes = S.routes.filter(x => x !== r);
      save(); closeSheet(); syncGlobe();
      toast('Rota kapatıldı.');
    };
    stats();
  });
}

// ---------- Rakipler ----------
function compList(comps) {
  if (!comps || !comps.length) return '<p class="meta" style="margin-top:8px">Bu hatta rakip yok.</p>';
  return `<h4>Bu hattaki rakipler</h4><div class="list">${comps.map(c => `
    <div class="item"><span class="swatch" style="background:${c.rv.color}"></span>
      <div class="grow"><div class="t">${c.rv.name}</div><div class="s">${c.route.n} uçak · ${num(c.seats)} koltuk/yön · bilet ${money(c.fare)} (${pct(c.fareMul)})</div></div>
      <div class="r">${num(2 * c.pax)}<div class="s">yolcu/gün</div></div></div>`).join('')}</div>`;
}

function rivalsHere(ap) {
  const here = (S.rivals || []).filter(rv => rv.active && rv.routes.some(rr => rr.a === ap.c || rr.b === ap.c));
  if (!here.length) return '';
  return `<h4>Burada uçan rakipler</h4><div class="list">${here.map(rv => {
    const n = rv.routes.filter(rr => rr.a === ap.c || rr.b === ap.c).length;
    return `<div class="item"><span class="swatch" style="background:${rv.color}"></span><div class="grow"><div class="t">${rv.name}${rv.hub === ap.c ? ' ★' : ''}</div><div class="s">${n} hat</div></div></div>`;
  }).join('')}</div>`;
}

function openNews() {
  selRoute = null; selAirport = null;
  S.newsSeen = S.news.length;
  updateNewsBadge();
  openSheet('news', body => {
    const act = sim.activeEvents(S).sort((a, b) => a.until - b.until);
    const extras = [];
    if (S.hedgeUntil > S.day) extras.push(`<div class="item"><span class="swatch" style="background:#06d6a0"></span><div class="grow"><div class="t">Yakıt fiyatın sabit</div><div class="s">Yakıt artışlarından etkilenmiyorsun</div></div><div class="ev-days">${S.hedgeUntil - S.day} gün</div></div>`);
    if ((S.wageMul || 1) > 1.001) extras.push(`<div class="item"><span class="swatch" style="background:#ffd166"></span><div class="grow"><div class="t">Ekip zammı</div><div class="s">Ekip maliyeti +%${Math.round((S.wageMul - 1) * 100)} (kalıcı)</div></div></div>`);
    if (S.cheapMaint) extras.push(`<div class="item"><span class="swatch" style="background:#ffd166"></span><div class="grow"><div class="t">Ucuz bakım anlaşması</div><div class="s">Genel gider −%20, teknik inceleme riski yüksek</div></div></div>`);
    body.innerHTML = `<h3>Haberler</h3><div class="meta">Süren olaylar ve son gelişmeler</div>
      <h4>Süren olaylar</h4>
      <div class="list">${act.map(e => {
        const d = describeEvent(e);
        const good = (e.dem ?? 1) > 1 || (e.rep ?? 1) > 1 || (e.fuel ?? 1) < 1;
        return `<div class="item"><span class="swatch" style="background:${good ? '#06d6a0' : '#ef476f'}"></span>
          <div class="grow"><div class="t">${e.title}</div><div class="s">${d.where ? d.where + ' · ' : ''}${d.effect}</div></div>
          <div class="ev-days">${e.until - S.day} gün</div></div>`;
      }).join('') + extras.join('') || '<p class="meta">Şu an süren bir olay yok.</p>'}</div>
      <h4>Son haberler</h4>
      <div class="list">${S.news.slice(-30).reverse().map(n => `
        <div class="item" style="min-height:0"><span class="swatch" style="background:${n.color}"></span><div class="grow"><div class="s" style="margin:0;color:var(--text)">${n.text}</div><div class="s">Gün ${n.day}</div></div></div>`).join('') || '<p class="meta">Henüz haber yok.</p>'}</div>`;
  });
}
$('btnNews').onclick = () => { if (S && !S.over) { if (panel && panel.name === 'news') closeSheet(); else openNews(); } };

function updateNewsBadge() {
  const n = S ? Math.max(0, S.news.length - (S.newsSeen || 0)) : 0;
  $('newsBadge').textContent = n ? (n > 9 ? '9+' : String(n)) : '';
}

// Karar kartı
function showDecision() {
  const v = decisionView(S);
  if (!v) return;
  $('decTitle').textContent = v.title;
  $('decText').textContent = v.text;
  const box = $('decOptions');
  box.innerHTML = '';
  v.options.forEach((o, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<b>${o.label}</b><span>${o.desc}${o.disabled ? ' (kasada yeterli para yok)' : ''}</span>`;
    b.disabled = o.disabled;
    b.onclick = () => {
      const news = decide(S, i);
      pushNews(news);
      $('decision').classList.remove('show');
      save(); updateHUD(); syncGlobe();
      if (panel) refreshSheet();
    };
    box.appendChild(b);
  });
  $('decision').classList.add('show');
}

function pushNews(news) {
  if (!news.length) return;
  S.news.push(...news.map(n => ({ ...n, day: S.day })));
  if (S.news.length > 80) { const cut = S.news.length - 80; S.news.splice(0, cut); S.newsSeen = Math.max(0, (S.newsSeen || 0) - cut); }
  updateNewsBadge();
}

function openRivals() {
  selRoute = null; selAirport = null;
  openSheet('rivals', body => {
    const myPax = S.history.length ? S.history[S.history.length - 1].pax : 0;
    const rows = [{ name: S.name + ' (sen)', color: '#ffd166', pax: myPax, routes: S.routes.length, fleet: S.fleet.length, hub: S.bases[0], me: true }]
      .concat((S.rivals || []).filter(rv => rv.active).map(rv => ({ name: rv.name, color: rv.color, pax: rv.lastPax, routes: rv.routes.length, fleet: rv.routes.reduce((s, r) => s + r.n, 0), hub: rv.hub, cash: rv.cash })));
    const total = rows.reduce((s, r) => s + r.pax, 0) || 1;
    rows.sort((x, y) => y.pax - x.pax);
    const gone = (S.rivals || []).filter(rv => !rv.active);
    const strength = c => c > 50e6 ? 'güçlü' : c > 5e6 ? 'orta' : c > 0 ? 'zayıf' : 'borçlu';
    body.innerHTML = `<h3>Rakipler</h3><div class="meta">Dünkü yolcu sayısına göre sıralama</div>
      <div class="list">${rows.map((r, i) => `
        <div class="item" ${r.me ? 'style="border-color:var(--accent)"' : ''}><b style="width:18px">${i + 1}</b><span class="swatch" style="background:${r.color}"></span>
          <div class="grow"><div class="t">${esc(r.name)}</div><div class="s">★ ${AP[r.hub].n} · ${r.routes} hat · ${r.fleet} uçak${r.cash != null ? ' · ' + strength(r.cash) : ''}</div></div>
          <div class="r">${num(r.pax)}<div class="s">%${Math.round(r.pax / total * 100)} pay</div></div></div>`).join('')}</div>
      ${gone.length ? `<p class="meta" style="margin-top:8px">İflas edenler: ${gone.map(g => g.name).join(', ')}</p>` : ''}
      <h4>Haberler</h4>
      <div class="list">${(S.news || []).filter(n => !n.kind).slice(-20).reverse().map(n => `
        <div class="item" style="min-height:0"><span class="swatch" style="background:${n.color}"></span><div class="grow"><div class="s" style="margin:0;color:var(--text)">${n.text}</div><div class="s">Gün ${n.day}</div></div></div>`).join('') || '<p class="meta">Henüz haber yok.</p>'}</div>`;
  });
}

// ---------- Paneller ----------
function openRoutes() {
  selRoute = null; selAirport = null;
  openSheet('routes', body => {
    body.innerHTML = `<h3>Rotalar</h3><div class="meta">${S.routes.length} rota · üslerin: ${S.bases.map(c => '★ ' + AP[c].n).join(', ')}</div>
      <div class="list" id="rList"></div><div class="row"><button id="rNew" class="primary">Yeni rota aç</button></div>`;
    const sorted = [...S.routes].sort((x, y) => (y.last?.net ?? 0) - (x.last?.net ?? 0));
    if (!sorted.length) body.querySelector('#rList').innerHTML = '<p class="meta">Henüz rotan yok.</p>';
    routeList(body.querySelector('#rList'), sorted);
    body.querySelector('#rNew').onclick = () => {
      if (S.bases.length === 1) startPick(AP[S.bases[0]]);
      else { hideSheet(); toast('Rotayı başlatmak için bir üssüne (★) dokun.'); }
    };
  });
}

function openFleet() {
  openSheet('fleet', body => {
    const fixed = S.fleet.reduce((s, f) => s + sim.fixedPerDay(f), 0);
    body.innerHTML = `<h3>Filo</h3><div class="meta">${S.fleet.length} uçak · günlük kira ve bakım ${money(fixed)}</div>
      <div class="list" id="fList"></div><div class="row"><button id="fMarket" class="primary">Uçak pazarı</button></div>`;
    const list = body.querySelector('#fList');
    if (!S.fleet.length) list.innerHTML = '<p class="meta">Filonda henüz uçak yok. Uçak pazarından kiralayarak başla.</p>';
    for (const f of S.fleet) {
      const ac = AC[f.type], r = S.routes.find(x => x.id === f.route);
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `<div class="grow"><div class="t">${ac.name} <span class="s">${f.reg}</span></div>
        <div class="s">${f.leased ? 'Kiralık' : 'Sahipli'} · ${r ? `${r.a} ⇄ ${r.b}` : 'Boşta'} · ${money(sim.fixedPerDay(f))}/gün</div></div>
        <button class="sm">${f.leased ? 'İade et' : 'Sat ' + money(ac.price * 1e6 * 0.7)}</button>`;
      row.querySelector('button').onclick = () => {
        const msg = f.leased ? `${f.reg} kiralayana iade edilsin mi?` : `${f.reg} ${money(ac.price * 1e6 * 0.7)} karşılığında satılsın mı?`;
        if (!confirm(msg + (r ? ` Uçak ${r.a} ⇄ ${r.b} rotasından çıkarılacak.` : ''))) return;
        if (r) r.planes = r.planes.filter(x => x !== f.id);
        if (!f.leased) S.cash += ac.price * 1e6 * 0.7;
        S.fleet = S.fleet.filter(x => x !== f);
        save(); syncGlobe(); refreshSheet();
      };
      list.appendChild(row);
    }
    body.querySelector('#fMarket').onclick = openMarket;
  });
}

function openMarket() {
  openSheet('market', body => {
    body.innerHTML = `<h3>Uçak pazarı</h3><div class="meta">Kiralama: başlangıçta 1 aylık kira, sonra günlük kira. Satın alma: peşin ödeme, düşük bakım gideri.</div><div class="list" id="mList"></div>
      <div class="row"><button id="mBack" class="ghost">Filoya dön</button></div>`;
    const list = body.querySelector('#mList');
    for (const ac of AIRCRAFT) {
      const locked = ac.tier > S.tier;
      const lease = sim.leasePerDay(ac), deposit = lease * 30, price = ac.price * 1e6;
      const row = document.createElement('div');
      row.className = 'item' + (locked ? ' locked-item' : '');
      row.style.flexWrap = 'wrap';
      row.innerHTML = `<div class="grow"><div class="t">${ac.maker} ${ac.name}</div>
        <div class="s">${ac.seats} koltuk · ${num(ac.range)} km menzil · ${ac.speed} km/s</div>
        ${locked ? `<div class="s">🔒 ${TIERS[ac.tier - 1].name} lisansı gerekir</div>` : `<div class="s">Kira ${money(lease)}/gün · fiyat ${money(price)}</div>`}</div>
        ${locked ? '' : `<div style="display:flex;gap:6px"><button class="sm" data-a="lease" ${S.cash < deposit ? 'disabled' : ''}>Kirala ${money(deposit)}</button>
        <button class="sm" data-a="buy" ${S.cash < price ? 'disabled' : ''}>Satın al</button></div>`}`;
      if (!locked) {
        row.querySelector('[data-a=lease]').onclick = () => acquire(ac, true, deposit);
        row.querySelector('[data-a=buy]').onclick = () => acquire(ac, false, price);
      }
      list.appendChild(row);
    }
    body.querySelector('#mBack').onclick = openFleet;
  });
}

function acquire(ac, leased, cost) {
  if (S.cash < cost) return toast('Kasada yeterli para yok.');
  S.cash -= cost;
  const f = { id: 'F' + S.seq++, type: ac.id, leased, reg: nextReg(), route: null };
  S.fleet.push(f);
  save(); updateHUD(true); refreshSheet();
  toast(`${ac.name} (${f.reg}) filona katıldı${leased ? ' (kiralık)' : ''}.`);
}

function renderLicense(body) {
  {
    body.innerHTML = `<h4>Lisanslar</h4><div class="meta">Toplam taşınan yolcu: <b>${num(S.totalPax)}</b></div><div class="list" id="lList"></div>`;
    const list = body.querySelector('#lList');
    for (const t of TIERS) {
      const have = S.tier >= t.id, next = t.id === S.tier + 1;
      const paxOk = S.totalPax >= t.pax, cashOk = S.cash >= t.fee;
      const planes = AIRCRAFT.filter(a => a.tier === t.id).map(a => a.name).join(', ');
      const row = document.createElement('div');
      row.className = 'item' + (have || next ? '' : ' locked-item');
      row.style.flexDirection = 'column'; row.style.alignItems = 'stretch';
      row.innerHTML = `<div class="t">${have ? '✓ ' : ''}${t.id}. ${t.name}</div>
        <div class="s">${t.desc}</div><div class="s">Yeni uçaklar: ${planes}</div>
        ${next ? `<div class="s" style="margin-top:6px">Yolcu: ${num(S.totalPax)} / ${num(t.pax)}</div>
          <div class="progress"><div style="width:${Math.min(100, S.totalPax / t.pax * 100)}%"></div></div>
          <button class="primary" style="margin-top:10px" ${paxOk && cashOk ? '' : 'disabled'}>Lisansı al (${money(t.fee)})</button>` : ''}`;
      if (next) row.querySelector('button').onclick = () => {
        S.cash -= t.fee; S.tier = t.id; save(); checkGoals();
        toast(`Tebrikler! ${t.name} lisansı alındı.`);
        if (t.id === 3) globe.flyTo(45, 25, 3.2);
        if (t.id === 4) globe.flyTo(30, 30, 1.6);
        updateHUD(true); refreshSheet();
      };
      list.appendChild(row);
    }
  }
}

// ---------- Gelişim paneli ----------
let growthTab = 'goals';
const GROWTH_TABS = [['goals', 'Görevler'], ['upgrades', 'Yükseltmeler'], ['auto', 'Otomasyon'], ['license', 'Lisans'], ['holding', 'Holding']];
function openGrowth(tab) {
  if (tab) growthTab = tab;
  selRoute = null; selAirport = null;
  openSheet('license', body => {
    const gs = P.goalState(S);
    body.innerHTML = `<h3>Gelişim</h3>
      <div class="tabs">${GROWTH_TABS.map(([k, l]) => `<button data-t="${k}" class="${k === growthTab ? 'on' : ''}">${l}${k === 'goals' && gs.claimable ? '<i class="dot"></i>' : ''}</button>`).join('')}</div>
      <div id="gBody"></div>`;
    body.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { growthTab = b.dataset.t; refreshSheet(); });
    const gb = body.querySelector('#gBody');
    ({ goals: renderGoals, upgrades: renderUpgrades, auto: renderAuto, license: renderLicense, holding: renderHolding })[growthTab](gb);
  });
}

function renderGoals(body) {
  const gs = P.goalState(S);
  body.innerHTML = `<div class="meta">Tamamlanan görevler: <b>${gs.doneCount} / ${gs.total}</b></div>
    <div class="progress" style="margin-bottom:12px"><div style="width:${gs.doneCount / gs.total * 100}%"></div></div>
    <div class="list" id="goalList"></div>`;
  const list = body.querySelector('#goalList');
  if (!gs.active.length) list.innerHTML = '<p class="warn">Tüm görevleri tamamladın! Holding kurarak yeniden başlayabilirsin.</p>';
  for (const g of gs.active) {
    const row = document.createElement('div');
    row.className = 'item';
    row.style.flexDirection = 'column'; row.style.alignItems = 'stretch';
    row.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px"><div class="t">${g.text}</div><div class="r pos">${money(g.reward)}</div></div>
      <div class="s">${num(g.cur)} / ${num(g.target)}</div>
      <div class="progress"><div style="width:${Math.min(100, g.cur / g.target * 100)}%"></div></div>
      ${g.ready ? '<button class="primary" style="margin-top:10px">Ödülü al</button>' : ''}`;
    if (g.ready) row.querySelector('button').onclick = () => {
      const r = P.claimGoal(S, g.id);
      if (r) { toast(`Görev tamamlandı: +${money(r)}`); save(); updateHUD(); refreshSheet(); }
    };
    list.appendChild(row);
  }
}

function renderUpgrades(body) {
  body.innerHTML = '<div class="meta">Kalıcı iyileştirmeler. Her seviye bir öncekinden pahalı.</div><div class="list" id="upList"></div>';
  const list = body.querySelector('#upList');
  for (const u of P.UPGRADES) {
    const L = sim.lvl(S, u.id), maxed = L >= u.max, locked = S.tier < u.tier;
    const cost = P.upgradeCost(u, L);
    const row = document.createElement('div');
    row.className = 'item' + (locked ? ' locked-item' : '');
    row.innerHTML = `<div class="grow"><div class="t">${u.name} <span class="lv">${'●'.repeat(L)}${'○'.repeat(u.max - L)}</span></div>
      <div class="s">${L ? 'Şu an: ' + u.desc(L) : 'Henüz yok'}</div>
      ${maxed ? '<div class="s pos">En üst seviye</div>' : locked ? `<div class="s">🔒 ${TIERS[u.tier - 1].name} lisansı gerekir</div>` : `<div class="s">Sonraki: ${u.desc(L + 1)}</div>`}</div>
      ${maxed || locked ? '' : `<button class="sm" ${S.cash < cost ? 'disabled' : ''}>${money(cost)}</button>`}`;
    const b = row.querySelector('button');
    if (b) b.onclick = () => { if (P.buyUpgrade(S, u.id)) { toast(`${u.name} seviye ${L + 1}`); save(); updateHUD(); syncGlobe(); refreshSheet(); } };
    list.appendChild(row);
  }
}

function renderAuto(body) {
  body.innerHTML = '<div class="meta">Müdürler oyunu senin yerine yönetir. Maaşları her gün genel gidere eklenir.</div><div class="list" id="mgList"></div>';
  const list = body.querySelector('#mgList');
  for (const m of P.MANAGERS) {
    const own = S.managers && S.managers[m.id], locked = S.tier < m.tier;
    const row = document.createElement('div');
    row.className = 'item' + (locked ? ' locked-item' : '');
    row.innerHTML = `<div class="grow"><div class="t">${m.name}</div><div class="s">${m.desc}</div>
      <div class="s">Maaş ${money(m.salary)}/gün${locked ? ` · 🔒 ${TIERS[m.tier - 1].name} lisansı gerekir` : ''}</div></div>
      ${locked ? '' : own ? `<button class="sm ${own.on ? 'on' : ''}">${own.on ? 'Açık' : 'Kapalı'}</button>` : `<button class="sm" ${S.cash < m.cost ? 'disabled' : ''}>İşe al ${money(m.cost)}</button>`}`;
    const b = row.querySelector('button');
    if (b) b.onclick = () => {
      if (own) { own.on = !own.on; toast(`${m.name} ${own.on ? 'açıldı' : 'kapatıldı'}.`); }
      else if (P.hireManager(S, m.id)) toast(`${m.name} işe alındı.`);
      save(); updateHUD(); refreshSheet();
    };
    list.appendChild(row);
  }
}

function renderHolding(body) {
  const st = P.starsFor(S), have = P.legacyStars(S), can = P.canPrestige(S);
  body.innerHTML = `<div class="meta">Holding kurduğunda şirketin sıfırdan başlar ama kazandığın yıldızlar kalıcıdır.</div>
    <div class="grid2">
      <div class="kv"><div class="k">Şirket değeri</div><div class="v">${money(P.companyValue(S))}</div></div>
      <div class="kv"><div class="k">Kazanacağın yıldız</div><div class="v">★ ${st}</div></div>
      <div class="kv"><div class="k">Sahip olduğun yıldız</div><div class="v">★ ${have}</div></div>
      <div class="kv"><div class="k">Kurulan holding</div><div class="v">${(S.legacy && S.legacy.count) || 0}</div></div>
    </div>
    <p class="meta" style="margin-top:10px">Şu anki bonusun: ${P.prestigeText(have)}.<br>Holding sonrası: ${P.prestigeText(have + st)}.</p>
    <p class="meta">Sıfırlananlar: kasa, filo, hatlar, üsler, lisans, yükseltmeler, müdürler, görevler, rakipler. Kalanlar: yıldızlar ve havayolu adın.</p>
    ${can ? '' : '<p class="warn">Holding kurmak için en az Kıtasal lisans ve 1 yıldızlık şirket değeri ($25M) gerekir.</p>'}
    <div class="row"><button id="btnPrestige" class="primary" ${can ? '' : 'disabled'}>Holding kur ve yeniden başla (★ +${st})</button></div>`;
  body.querySelector('#btnPrestige').onclick = () => {
    if (!P.canPrestige(S)) return;
    if (!confirm(`Holding kurulsun mu? Şirketin sıfırlanacak, ★ ${st} yıldız kazanacaksın. Bu geri alınamaz.`)) return;
    const legacy = { count: ((S.legacy && S.legacy.count) || 0) + 1, stars: have + st };
    const ns = newState(S.name, S.firstBase || S.bases[0], legacy);
    ns.cash += 1e6 * legacy.stars;
    ns.firstBase = S.firstBase || S.bases[0];
    startGame(ns);
    save();
    toast(`Holding kuruldu! ★ ${legacy.stars} yıldızla yeniden başlıyorsun.`);
  };
}

function openReport() {
  openSheet('report', body => {
    const last = S.history[S.history.length - 1];
    const hist = S.history.slice(-30);
    const max = Math.max(1, ...hist.map(h => Math.abs(h.profit)));
    const fixed = S.fleet.reduce((s, f) => s + sim.fixedPerDay(f), 0);
    body.innerHTML = `<h3>Rapor</h3><div class="meta">Gün ${S.day} · ${S.fleet.length} uçak · ${S.routes.length} rota</div>
      ${last ? `<div class="grid2">
        <div class="kv"><div class="k">Dünkü gelir</div><div class="v">${money(last.revenue)}</div></div>
        <div class="kv"><div class="k">Dünkü gider</div><div class="v">${money(last.cost)}</div></div>
        <div class="kv"><div class="k">Dünkü kâr</div><div class="v ${sign(last.profit)}">${money(last.profit)}</div></div>
        <div class="kv"><div class="k">Dünkü yolcu</div><div class="v">${num(last.pax)}</div></div>
      </div>` : '<p class="meta">İlk gün henüz bitmedi. Gün sonunda (00:00) hesap yapılır.</p>'}
      <h4>Son ${hist.length} günün kârı</h4>
      <div class="bars">${hist.map(h => `<div style="height:${Math.abs(h.profit) / max * 100}%;background:${h.profit >= 0 ? 'var(--good)' : 'var(--bad)'}"></div>`).join('')}</div>
      <h4>Sabit giderler (günlük)</h4>
      <div class="grid2">
        <div class="kv"><div class="k">Uçak kira/bakım</div><div class="v">${money(fixed)}</div></div>
        <div class="kv"><div class="k">Genel gider</div><div class="v">${money(sim.overheadPerDay(S))}</div></div>
      </div>
      <h4>Rotalar</h4><div class="list" id="repRoutes"></div>`;
    const sorted = [...S.routes].sort((x, y) => (y.last?.net ?? 0) - (x.last?.net ?? 0));
    routeList(body.querySelector('#repRoutes'), sorted);
  });
}

document.querySelectorAll('#nav button').forEach(b => b.onclick = () => {
  if (!S || S.over) return;
  if (panel && panel.name === b.dataset.panel) return closeSheet();
  pickFrom = null; globe.setPreview(null);
  ({ routes: openRoutes, fleet: openFleet, license: () => openGrowth(), report: openReport, rivals: openRivals })[b.dataset.panel]();
  if (selRoute) { selRoute = null; syncGlobe(); }
});

// ---------- Üst çubuk ve ipucu ----------
let hintKey = '';
function updateHint(force) {
  const h = $('hint');
  let key = '', html = '';
  if (!S) { key = 'none'; }
  else if (pickFrom) {
    key = 'pick' + pickFrom.c;
    html = `<b>${pickFrom.n}</b> → hedef havaalanına dokun. Yeşil halkalılar uygun. <button class="sm" id="hintCancel" style="margin-left:6px">İptal</button>`;
  } else if (S.cash < 0) {
    key = 'debt'; html = `Kasa eksiye düştü, faiz işliyor. <b>${money(sim.BANKRUPT)}</b> altına inersen iflas edersin.`;
  } else if (!S.fleet.length) {
    key = 'fleet'; html = 'İlk adım: aşağıdan <b>Filo</b> → <b>Uçak pazarı</b>\'na gir ve bir <b>ATR 72</b> kirala.';
  } else if (!S.routes.length) {
    key = 'route'; html = `Şimdi üssüne (<b>★ ${AP[S.bases[0]].n}</b>) dokun ve <b>Buradan rota aç</b>'a bas. Kalabalık şehirler daha çok yolcu demek.`;
  } else if (S.day < 2) {
    key = 'speed'; html = 'Harika! Uçakların uçuyor. Gece yarısı gün kapanır ve kâr hesaplanır. Sağ üstten hızı <b>4×</b> yapabilirsin.';
  } else if (S.tier < 4 && S.totalPax >= TIERS[S.tier].pax && S.cash >= TIERS[S.tier].fee) {
    key = 'lic' + S.tier; html = `<b>${TIERS[S.tier].name}</b> lisansını alabilirsin! <b>Gelişim → Lisans</b>'a bak.`;
  }
  if (key === hintKey && !force) return;
  hintKey = key;
  h.innerHTML = html;
  h.classList.toggle('show', !!html);
  const c = h.querySelector('#hintCancel');
  if (c) c.onclick = cancelPick;
}

function updateHUD() {
  if (!S) return;
  const c = $('cash');
  c.textContent = money(S.cash);
  c.classList.toggle('neg', S.cash < 0);
  const tr = new Date(sim.gameDate(S.t).getTime() + 3 * 3600e3); // TSİ
  $('dateLbl').textContent = `${tr.getUTCDate()} ${MONTHS[tr.getUTCMonth()]} ${tr.getUTCFullYear()}`;
  $('clock').textContent = `${String(tr.getUTCHours()).padStart(2, '0')}:${String(tr.getUTCMinutes()).padStart(2, '0')}`;
  $('tierBadge').textContent = tier().name;
  $('airlineName').textContent = S.name;
  updateHint();
}

document.querySelectorAll('.speed button').forEach(b => b.onclick = () => {
  speed = Number(b.dataset.speed);
  document.querySelectorAll('.speed button').forEach(x => x.classList.toggle('on', x === b));
});

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- Görevler ve çevrimdışı kazanç ----------
function checkGoals() {
  if (!S) return;
  const ready = P.newlyReady(S);
  if (ready.length) toast(`Görev tamamlandı: ${ready[0].text}. Ödülünü Gelişim menüsünden al.`);
  updateGrowthDot();
}
function updateGrowthDot() {
  const b = document.querySelector('#nav [data-panel=license]');
  if (b) b.classList.toggle('has-dot', !!(S && P.goalState(S).claimable));
}

function showOffline(ms) {
  if (!S || S.over) return;
  const o = P.offlineEarnings(S, ms);
  if (!o) return;
  const h = Math.floor(o.minutes / 60), m = Math.round(o.minutes % 60);
  $('offTime').textContent = h ? `${h} saat ${m} dakika` : `${m} dakika`;
  $('offMoney').textContent = o.noProfit ? '$0' : '+' + money(o.money);
  $('offPax').textContent = num(o.pax);
  $('offNote').textContent = o.noProfit
    ? 'Son günlerde kâr etmediğin için çevrimdışı kazanç yok.'
    : `Son 7 günün ortalamasına göre, %${Math.round(o.eff * 100)} verimle hesaplandı.${o.capped ? ` En fazla ${o.capH} saatlik kazanç alınabilir (Gece vardiyası müdürü yükseltmesiyle artar).` : ''}`;
  $('btnOffline').onclick = () => {
    S.cash += o.money; S.totalPax += o.pax;
    $('offline').classList.remove('show');
    save(); updateHUD(); checkGoals();
    if (o.money > 0) toast(`Çevrimdışı kazanç: +${money(o.money)}`);
  };
  $('offline').classList.add('show');
}

// Telefonda arka plana alınınca ya da sekme gizlenince
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (!S) return;
  if (document.hidden) { hiddenAt = Date.now(); save(); }
  else if (hiddenAt) { const ms = Date.now() - hiddenAt; hiddenAt = 0; showOffline(ms); }
});
window.addEventListener('pagehide', () => save());

// ---------- Gün sonu ----------
function endOfDay() {
  const rec = sim.settleDay(S);
  const news = spawnRivals(S);
  if (S.day % 7 === 0) news.push(...weeklyRivals(S));
  news.push(...dailyEvents(S));
  news.push(...P.runManagers(S, (a, b, ids) => addRoute(a, b, ids)));
  pushNews(news);
  syncGlobe();
  save();
  if (panel && ['report', 'routes', 'license', 'fleet', 'rivals', 'news', 'route'].includes(panel.name)) refreshSheet();
  if (S.pendingDecision && !$('decision').classList.contains('show')) showDecision();
  checkGoals();
  const imp = news.filter(n => n.important);
  if (imp.length) toast(imp[0].text + (imp.length > 1 ? ` (+${imp.length - 1} haber daha, Haberler'e bak)` : ''));
  else if (S.day % 7 === 0) toast(`Hafta özeti: dünkü kâr ${money(rec.profit)} · ${num(rec.pax)} yolcu`);
  if (S.cash < sim.BANKRUPT) gameOver();
}

function gameOver() {
  S.over = true; save();
  $('goText').innerHTML = `${esc(S.name)} ${S.day} gün dayanabildi.<br><br>Taşınan yolcu: <b>${num(S.totalPax)}</b><br>Filo: <b>${S.fleet.length}</b> uçak · Rota: <b>${S.routes.length}</b>`;
  $('gameover').classList.add('show');
}

// ---------- Döngü ----------
let lastNow = performance.now(), hudAcc = 1, goalAcc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  if (S && !S.over && speed > 0 && !$('decision').classList.contains('show') && !$('offline').classList.contains('show')) {
    const before = Math.floor((S.t + DAY_OFFSET) / 24);
    S.t += dt * speed;
    const after = Math.floor((S.t + DAY_OFFSET) / 24);
    for (let i = before; i < after && !S.over; i++) endOfDay();
  }
  if (S) { globe.setSun(sim.gameDate(S.t)); globe.updatePlanes(S.t); }
  else globe.setSun(new Date(sim.START));
  traffic.tick(dt);
  hudAcc += dt;
  if (hudAcc > 0.25) { hudAcc = 0; updateHUD(); updateMarkers(); }
  goalAcc += dt; if (goalAcc > 2) { goalAcc = 0; checkGoals(); }
  requestAnimationFrame(frame);
}

// ---------- Başlangıç ----------
function startGame(state) {
  S = state;
  S.rivals = S.rivals || []; S.news = S.news || []; S.events = S.events || [];
  S.upgrades = S.upgrades || {}; S.managers = S.managers || {}; S.goalsDone = S.goalsDone || []; S.goalsNotified = S.goalsNotified || [];
  S.firstBase = S.firstBase || S.bases[0];
  const away = S.lastSeen ? Date.now() - S.lastSeen : 0;
  if (away > 0) setTimeout(() => showOffline(away), 700);
  updateGrowthDot();
  if (S.newsSeen == null) S.newsSeen = S.news.length;
  spawnRivals(S);
  updateNewsBadge();
  if (S.pendingDecision) setTimeout(showDecision, 600);
  $('start').classList.remove('show');
  $('gameover').classList.remove('show');
  closeSheet();
  syncGlobe();
  const b = AP[S.bases[0]];
  globe.flyTo(b.lat, b.lon, S.tier >= 4 ? 1.8 : S.tier >= 3 ? 3.2 : 5);
  hintKey = ''; updateHUD();
}

function setupStart() {
  const sel = $('baseInput');
  sel.innerHTML = AIRPORTS.filter(a => a.z === 'TR').sort((x, y) => y.p - x.p)
    .map(a => `<option value="${a.c}">${a.n} (${a.c})</option>`).join('');
  sel.value = 'IST';
  const saved = loadSave();
  const box = $('continueBox');
  box.innerHTML = '';
  if (saved) {
    const btn = document.createElement('button');
    btn.className = 'primary big';
    btn.textContent = `Devam et: ${saved.name} · gün ${saved.day}`;
    btn.onclick = () => startGame(saved);
    box.appendChild(btn);
    $('btnNew').classList.remove('primary');
  }
}
$('btnNew').onclick = () => {
  if (loadSave() && !confirm('Kayıtlı oyunun silinecek. Yeni oyun başlasın mı?')) return;
  const name = $('nameInput').value.trim() || 'Anadolu Kanatları';
  startGame(newState(name, $('baseInput').value));
  save();
};
$('btnRestart').onclick = () => { $('gameover').classList.remove('show'); S = null; syncGlobe(); setupStart(); $('start').classList.add('show'); };

setupStart();
requestAnimationFrame(frame);

// Test için: ?debug ile açınca konsoldan erişilebilir.
if (location.search.includes('debug')) window.SKY = { get S() { return S; }, sim, globe, endOfDay, openPlanner, createRoute, acquire, AP, AC, zoomToAirport, traffic, openRivals, spawnRivals, weeklyRivals, openNews, showDecision, dailyEvents, P, openGrowth, showOffline, addRoute };
