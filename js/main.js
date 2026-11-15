// Oyun döngüsü, arayüz ve kayıt.
import { Globe } from './globe.js';
import { AirportTraffic } from './traffic3d.js?v=15';
import { AIRPORTS, AIRCRAFT, TIERS, ZONES } from './data.js';
import * as sim from './sim.js';
import { spawnRivals, weeklyRivals, rivalFlightsAt } from './rivals.js';
import { dailyEvents, decisionView, decide, describeEvent } from './events.js';
import * as P from './progress.js';
import * as D from './depth.js';
import { settings, saveSettings, encodeSave, decodeSave, downloadText } from './settings.js';
import { fx, play, applyVolume } from './audio.js';
import { floatText, pulse, confetti, celebrate } from './fx.js';
import { lineChart, barChart, bindCharts } from './charts.js';
import { nextTip, GUIDE, TIPS } from './tutorial.js';
import * as G from './game.js';
import * as X from './extra.js';
import * as SC from './scenarios.js';
import * as ID from './identity.js';
import * as DY from './daily.js';

const VERSION = '1.2';

const { AP, AC } = sim;
const SAVE_KEY = 'skyweave-save-v2', DAILY_KEY = 'skyweave-daily';
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const { DAY_OFFSET } = G;
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
const newState = G.newState;
function save() { if (!S) return; try { S.lastSeen = Date.now(); localStorage.setItem(S.daily ? DAILY_KEY : SAVE_KEY, JSON.stringify(S)); } catch (_) { /* depolama yok */ } }
function loadSave(key = SAVE_KEY) {
  try { const s = JSON.parse(localStorage.getItem(key)); return s && s.v === 2 && !s.over ? s : null; } catch (_) { return null; }
}
const nextReg = () => G.nextReg(S);

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
  if (!panel || panel.name !== name) $('sheet').scrollTop = 0;
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
      ${slotBox(ap, locked)}
      ${base ? hubBox(ap) : ''}
      ${routes.length ? '<h4>Rotalar</h4><div class="list" id="apRoutes"></div>' : ''}
      ${rivalsHere(ap)}
      <div class="row" id="apActions"></div>`;
    if (routes.length) routeList(body.querySelector('#apRoutes'), routes);
    const sb = body.querySelector('#slotBuy');
    if (sb) sb.onclick = () => {
      const price = sim.slotPackPrice(S, ap.c);
      if (S.cash < price) return;
      S.cash -= price; S.slots[ap.c] = sim.slotPacks(S, ap.c) + 1; fx('buy');
      toast(`${ap.n}: +${sim.SLOT_PACK} günlük kalkış hakkı alındı.`); save(); updateHUD(); refreshSheet();
    };
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
        const bc = sim.baseCost(S);
        bb.textContent = `Üs kur (${money(bc)})`;
        bb.disabled = S.cash < bc;
        bb.title = 'Her yeni üs bir öncekinden %80 pahalı';
        bb.onclick = () => {
          if (S.cash < bc) return;
          S.cash -= bc; S.bases.push(ap.c); floatText('−' + money(bc), { good: false }); fx('fanfare'); confetti(120);
          toast(`${ap.n} artık üssün!`); save(); refreshSheet();
        };
        act.appendChild(bb);
      }
    }
  });
}

// Slot (kalkış hakkı) kutusu
function slotBox(ap, locked) {
  if (!sim.slotControlled(ap)) return '<p class="meta" style="margin-top:10px">Slot sınırı yok: istediğin kadar sefer koyabilirsin.</p>';
  const cap = sim.slotCap(S, ap.c), used = sim.slotUsed(S, ap.c), over = used > cap + 0.01;
  return `<h4>Slotlar (günlük kalkış hakkı)</h4>
    <div class="item" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;justify-content:space-between"><span class="t">${used.toFixed(1)} / ${cap} kalkış</span><span class="s">${S.bases.includes(ap.c) ? `üs: ${sim.BASE_SLOTS} ücretsiz` : `${sim.FREE_SLOTS} ücretsiz`}</span></div>
      <div class="progress"><div style="width:${Math.min(100, used / cap * 100)}%;${over ? 'background:var(--bad)' : ''}"></div></div>
      ${over ? `<div class="s neg" style="margin-top:6px">Slot yetmiyor: buradaki seferlerin %${Math.round(100 - cap / used * 100)}'i yapılamıyor.</div>` : ''}
      ${locked ? '' : `<button class="sm" id="slotBuy" style="margin-top:8px" ${S.cash < sim.slotPackPrice(S, ap.c) ? 'disabled' : ''}>+${sim.SLOT_PACK} slot satın al (${money(sim.slotPackPrice(S, ap.c))})</button>`}
    </div>`;
}

// Aktarma merkezi kutusu (üsler)
function hubBox(ap) {
  const n = (S.hubPax || {})[ap.c] || 0;
  const flows = (S.transfers || []).filter(f => f.h === ap.c).slice(0, 5);
  return `<h4>Aktarma merkezi</h4>
    <p class="meta">Bu üsse bağlanan iki hattın uçları arasında yolcular burada aktarma yapar. Hatlardaki boş koltukları doldururlar.</p>
    <div class="grid2"><div class="kv"><div class="k">Dün aktarma yapan</div><div class="v">${num(n)}</div></div>
      <div class="kv"><div class="k">Buraya bağlı hat</div><div class="v">${S.routes.filter(r => r.a === ap.c || r.b === ap.c).length}</div></div></div>
    ${flows.length ? `<div class="list" style="margin-top:8px">${flows.map(f => `<div class="item" style="min-height:0"><div class="grow"><div class="t">${AP[f.x].n} → ${AP[f.y].n}</div></div><div class="r">${num(f.pax)}<div class="s">yolcu/gün</div></div></div>`).join('')}</div>` : ''}`;
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
        <p class="meta" style="margin-top:8px">Yeni rotada talep %40'tan başlar, 30 günde tam seviyeye çıkar.</p>` : '') + slotWarn([a, b], [...chosen].reduce((s, id) => s + sim.planeDeps(S, d, fleetById(id).type), 0)) + compList(e.comps);
      body.querySelector('#pkOpen').disabled = !chosen.size;
    };
    body.querySelector('#pkFare').oninput = e => { fareMul = e.target.value / 100; est(); };
    body.querySelector('#pkCancel').onclick = () => { closeSheet(); };
    body.querySelector('#pkOpen').onclick = () => createRoute(a, b, [...chosen], fareMul);
    est();
  });
}

// Eklenecek kalkışlar slotlara sığmıyorsa uyarı
function slotWarn(aps, need) {
  if (!need) return '';
  const out = [];
  for (const ap of aps) {
    if (!sim.slotControlled(ap)) continue;
    const free = sim.slotFree(S, ap.c);
    if (need > free + 0.01) out.push(`${ap.n}: günde ${need.toFixed(1)} kalkış gerekir, boş slot ${Math.max(0, free).toFixed(1)}`);
  }
  return out.length ? `<p class="err" style="margin-top:8px">Slot yetmiyor. ${out.join(' · ')}. Fazla seferler yapılamaz; havalimanı ekranından slot satın al.</p>` : '';
}

const addRoute = (a, b, planeIds, fareMul = 1) => G.addRoute(S, a, b, planeIds, fareMul);

function createRoute(a, b, planeIds, fareMul) {
  const r = addRoute(a, b, planeIds, fareMul);
  pickFrom = null;
  globe.setPreview(null);
  save();
  fx('takeoff');
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
      <h4>Kabin düzeni</h4>
      <div class="tabs" id="rtCabin">${sim.CABINS.map(c => `<button data-c="${c.id}" class="${(r.cabin || 0) === c.id ? 'on' : ''}">${c.name}</button>`).join('')}</div>
      <p class="meta" id="rtCabinNote"></p>
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
          <div class="kv"><div class="k">Kargo (ton/gün) · gelir</div><div class="v">${(Math.round(e.cargo * 10) / 10).toLocaleString('tr-TR')} · ${money(e.cargoRev)}</div></div>
          ${e.bSeats ? `<div class="kv"><div class="k">Business doluluk · bilet</div><div class="v">${pct(e.bizLoad)} · ${money(e.bFare)}</div></div>` : ''}
          ${r.last && r.last.tdem ? `<div class="kv"><div class="k">Dün aktarmalı yolcu / talep</div><div class="v">${num(r.last.tpax)} / ${num(r.last.tdem)}</div></div>` : ''}
          ${r.last ? `<div class="kv"><div class="k">Dünkü kâr (aktarma dahil)</div><div class="v ${sign(r.last.net)}">${money(r.last.net)}</div></div>` : ''}
        </div>
        ${r.last && r.last.tdem > r.last.tpax * 1.3 + 20 ? '<p class="warn" style="margin-top:8px">Aktarmalı yolcular yer bulamıyor: aktarma yolcuları yalnızca boş koltukları kullanır. Uçak eklersen fazla koltukları onlar doldurur.</p>' : ''}
        ${e.cargoDem > e.cargo * 1.25 + 1 ? `<p class="meta" style="margin-top:8px">Kargo bölmesi dolu: günde ${num(e.cargoDem - e.cargo)} ton yük kalıyor. Daha büyük uçaklar daha çok kargo taşır.</p>` : ''}
        ${routeContracts(r)}
        ${e.slotLimited ? '<p class="err" style="margin-top:8px">Slot yetmiyor: seferlerin bir kısmı yapılamıyor. Uç havalimanlarından slot satın al.</p>' : ''}
        ${routeEventWarnings(r)}
        ${compList(e.comps)}
        ${routeCharts(r)}
        ${sim.rampP(S, r.age) < 1 ? `<p class="meta" style="margin-top:8px">Rota yeni: talep şu an tam seviyenin %${Math.round(100 * sim.rampP(S, r.age))}'ında.</p>` : ''}
        ${e.load > 0.98 && e.demand > e.seats * 1.2 ? '<p class="warn">Talep koltuktan fazla: uçak ekle ya da bilet fiyatını artır.</p>' : ''}
        ${e.load < 0.6 && r.planes.length ? '<p class="warn">Doluluk düşük: fiyatı indir ya da bir uçağı başka rotaya al.</p>' : ''}`;
      bindCharts(body.querySelector('#rtStats'), FMTS);
    };
    body.querySelector('#rtFare').oninput = e => { r.fareMul = e.target.value / 100; stats(); };
    body.querySelector('#rtFare').onchange = () => save();
    const cabNote = () => {
      const c = sim.cabinOf(r), e = sim.routeEcon(r, S.fleet, doyNow(), false, S);
      body.querySelector('#rtCabinNote').textContent = `${c.desc}. Yön başına günde ${num(e.seats)} ekonomi${e.bSeats ? ` + ${num(e.bSeats)} business` : ''} koltuk. Business bileti ekonominin ${String(sim.BIZ_FARE).replace('.', ',')} katı, ama bir business koltuğu ${String(sim.BIZ_SPACE).replace('.', ',')} ekonomi koltuğu yer kaplar.`;
    };
    body.querySelectorAll('#rtCabin button').forEach(btn => btn.onclick = () => { r.cabin = Number(btn.dataset.c); save(); refreshSheet(); });
    cabNote();

    const pl = body.querySelector('#rtPlanes');
    if (!r.planes.length) pl.innerHTML = '<p class="warn">Bu rotada uçak yok, sefer yapılmıyor.</p>';
    for (const id of r.planes) {
      const f = fleetById(id), ac = AC[f.type];
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `<div class="grow"><div class="t">${ac.name}</div><div class="s">${f.reg} · günde ${sim.rtPerDay(d, ac).toFixed(1)} gidiş-dönüş · ${planeStatus(f)}</div></div><button class="sm">Çıkar</button>`;
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

// Hat geçmişi grafikleri (son 60 gün)
const FMTS = { money: v => money(v), num: v => num(v), pctf: v => pct(v) };
const pctf = FMTS.pctf;
const dayLbl = d => `Gün ${d}`;
function routeCharts(r) {
  const h = r.hist || [];
  if (h.length < 2) return '';
  const labels = h.map(x => dayLbl(x.d));
  const nets = h.map(x => x.net);
  const best = h.reduce((b, x) => x.net > b.net ? x : b, h[0]), worst = h.reduce((b, x) => x.net < b.net ? x : b, h[0]);
  const hasShare = h.some(x => x.share != null && x.share < 0.999);
  return `<h4>Son ${h.length} gün</h4>
    <div class="chart-title">Günlük kâr</div>${barChart({ values: nets, labels, height: 70 })}
    <div class="chart-title">Doluluk${hasShare ? ' <span style="color:#4cc9f0">· pazar payı</span>' : ''}</div>
    ${lineChart({ series: [{ values: h.map(x => x.load), color: '#ffd166', label: 'doluluk', fill: true }].concat(hasShare ? [{ values: h.map(x => x.share ?? 1), color: '#4cc9f0', label: 'pay' }] : []), labels, height: 80, fmt: pctf, min: 0, max: 1 })}
    <div class="grid2" style="margin-top:8px">
      <div class="kv"><div class="k">En iyi gün (${best.d}. gün)</div><div class="v ${sign(best.net)}">${money(best.net)}</div></div>
      <div class="kv"><div class="k">En kötü gün (${worst.d}. gün)</div><div class="v ${sign(worst.net)}">${money(worst.net)}</div></div>
    </div>`;
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
      if (!S.pendingDecision) { $('decision').classList.remove('show'); return; }
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
    const rows = [{ name: S.name + ' (sen)', color: ID.brandOf(S).color, pax: myPax, routes: S.routes.length, fleet: S.fleet.length, hub: S.bases[0], me: true }]
      .concat((S.rivals || []).filter(rv => rv.active).map(rv => ({ name: rv.name, color: rv.color, pax: rv.lastPax, routes: rv.routes.length, fleet: rv.routes.reduce((s, r) => s + r.n, 0), hub: rv.hub, cash: rv.cash })));
    const total = rows.reduce((s, r) => s + r.pax, 0) || 1;
    rows.sort((x, y) => y.pax - x.pax);
    const gone = (S.rivals || []).filter(rv => !rv.active);
    const strength = c => c > 50e6 ? 'güçlü' : c > 5e6 ? 'orta' : c > 0 ? 'zayıf' : 'borçlu';
    const buyable = (S.rivals || []).filter(rv => rv.active);
    body.innerHTML = `<h3>Rakipler</h3><div class="meta">Dünkü yolcu sayısına göre sıralama</div>
      <div class="list">${rows.map((r, i) => `
        <div class="item" ${r.me ? 'style="border-color:var(--accent)"' : ''}><b style="width:18px">${i + 1}</b><span class="swatch" style="background:${r.color}"></span>
          <div class="grow"><div class="t">${esc(r.name)}</div><div class="s">★ ${AP[r.hub].n} · ${r.routes} hat · ${r.fleet} uçak${r.cash != null ? ' · ' + strength(r.cash) : ''}</div></div>
          <div class="r">${num(r.pax)}<div class="s">%${Math.round(r.pax / total * 100)} pay</div></div></div>`).join('')}</div>
      ${gone.length ? `<p class="meta" style="margin-top:8px">Pazardan çıkanlar: ${gone.map(g => esc(g.name) + (g.acquired ? ' (satın aldın)' : ' (iflas)')).join(', ')}</p>` : ''}
      <h4>Şirket satın al</h4>
      <p class="meta">Bir rakibi satın alırsan merkezi senin üssün olur, hatları ve uçakları (kiralık, 4 yaşında) sana geçer. Zor durumdaki rakip daha ucuzdur.</p>
      <div class="list" id="rvBuy">${buyable.map(rv => { const why = X.canAcquire(S, rv), c = X.acquireCost(S, rv); return `
        <div class="item"><span class="swatch" style="background:${rv.color}"></span><div class="grow"><div class="t">${esc(rv.name)}</div>
          <div class="s">${rv.routes.length} hat · ${rv.routes.reduce((s, r) => s + r.n, 0)} uçak · fiyat ${money(c)}</div>${why ? `<div class="s">🔒 ${why}</div>` : ''}</div>
          <button class="sm" data-rv="${rv.id}" ${why ? 'disabled' : ''}>Satın al</button></div>`; }).join('') || '<p class="meta">Satın alınacak rakip kalmadı.</p>'}</div>
      <h4>Haberler</h4>
      <div class="list">${(S.news || []).filter(n => !n.kind).slice(-20).reverse().map(n => `
        <div class="item" style="min-height:0"><span class="swatch" style="background:${n.color}"></span><div class="grow"><div class="s" style="margin:0;color:var(--text)">${n.text}</div><div class="s">Gün ${n.day}</div></div></div>`).join('') || '<p class="meta">Henüz haber yok.</p>'}</div>`;
    bind(body, '#rvBuy button[data-rv]', btn => {
      const rv = S.rivals.find(x => x.id === btn.dataset.rv);
      if (!rv || X.canAcquire(S, rv)) return;
      const c = X.acquireCost(S, rv);
      if (!confirm(`${rv.name} ${money(c)} karşılığında satın alınsın mı? ${AP[rv.hub].n} üssün olur, hatları ve uçakları sana geçer.`)) return;
      const res = X.acquireRival(S, rv);
      if (!res) return;
      save(); syncGlobe(); updateHUD(true); hideSheet();
      fx('fanfare');
      pushNews([{ text: `${S.name}, ${rv.name} şirketini ${money(res.cost)} karşılığında satın aldı.`, color: rv.color, important: true }]);
      celebrate({ tag: 'Satın alma', title: rv.name, text: `${rv.name} artık ${S.name} çatısı altında.`, items: [`${AP[rv.hub].n} üssün oldu`, `${res.routes} hat ve ${res.planes} uçak devraldın`, 'Devralınan uçaklar kiralık ve 4 yaşında'], button: 'Haritaya dön' });
    });
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

// Uçağın kısa durumu: yaş, kondisyon, bakım
const yrs = f => sim.ageYears(f).toLocaleString('tr-TR', { maximumFractionDigits: 1, minimumFractionDigits: f.age ? 1 : 0 });
function planeStatus(f) {
  if (sim.isDown(S, f)) return `<span class="neg">${f.down.why === 'check' ? 'Bakımda' : 'Arızalı'} (${f.down.until - S.day} gün)</span>`;
  const c = Math.round(sim.condOf(f));
  return `${yrs(f)} yaş · durum <span class="${c < 60 ? 'neg' : c < 75 ? 'warnc' : ''}">%${c}</span>`;
}

function openFleet() {
  openSheet('fleet', body => {
    const fixed = S.fleet.reduce((s, f) => s + sim.playerFixed(S, f), 0);
    const avgAge = S.fleet.length ? S.fleet.reduce((s, f) => s + sim.ageYears(f), 0) / S.fleet.length : 0;
    const q = sim.fleetQuality(S);
    body.innerHTML = `<h3>Filo</h3><div class="meta">${S.fleet.length} uçak · günlük kira ve bakım ${money(fixed)} · ortalama yaş ${avgAge.toFixed(1).replace('.', ',')}</div>
      ${q < 0.999 ? `<p class="warn">Filonun yaşı ve durumu itibarını %${Math.round((1 - q) * 100)} düşürüyor. Ağır bakım yaptır ya da yaşlı uçakları yenile.</p>` : ''}
      <div class="list" id="fList"></div><div class="row"><button id="fMarket" class="primary">Uçak pazarı</button></div>
      <p class="meta" style="margin-top:10px">Uçan uçaklar yıpranır. Durumu %65'in altına düşen uçak arıza yapabilir. Ağır bakım ${sim.CHECK_DAYS} gün sürer ve durumu yeniler; yaşlı uçak tam yenilenmez.</p>`;
    const list = body.querySelector('#fList');
    if (!S.fleet.length) list.innerHTML = '<p class="meta">Filonda henüz uçak yok. Uçak pazarından kiralayarak başla.</p>';
    for (const f of S.fleet) {
      const ac = AC[f.type], r = S.routes.find(x => x.id === f.route);
      const val = sim.planeValue(f), cc = sim.checkCost(f), c = sim.condOf(f);
      const row = document.createElement('div');
      row.className = 'item';
      row.style.flexWrap = 'wrap';
      row.innerHTML = `<div class="grow"><div class="t">${ac.name} <span class="s">${f.reg} · ${f.leased ? 'kiralık' : 'sahipli'}</span></div>
        <div class="s">${r ? `${r.a} ⇄ ${r.b}` : 'Boşta'} · ${money(sim.playerFixed(S, f))}/gün</div>
        <div class="s">${planeStatus(f)}</div>
        <div class="progress"><div style="width:${c}%;background:${c < 60 ? 'var(--bad)' : c < 75 ? 'var(--accent)' : 'var(--good)'}"></div></div></div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="sm" data-a="mx" ${D.canCheck(S, f) ? '' : 'disabled'}>Bakım ${money(cc)}</button>
          <button class="sm" data-a="sell">${f.leased ? 'İade et' : 'Sat ' + money(val)}</button></div>`;
      row.querySelector('[data-a=mx]').onclick = () => {
        if (!confirm(`${f.reg} ${sim.CHECK_DAYS} gün ağır bakıma girsin mi? Bedel ${money(cc)}. Durumu %${Math.round(sim.checkRestores(f))}'e çıkacak.`)) return;
        if (D.startCheck(S, f)) { toast(`${f.reg} bakıma alındı.`); save(); updateHUD(); syncGlobe(); refreshSheet(); checkGoals(); }
      };
      row.querySelector('[data-a=sell]').onclick = () => {
        const msg = f.leased ? `${f.reg} kiralayana iade edilsin mi?` : `${f.reg} ${money(val)} karşılığında satılsın mı?`;
        if (!confirm(msg + (r ? ` Uçak ${r.a} ⇄ ${r.b} rotasından çıkarılacak.` : ''))) return;
        if (r) r.planes = r.planes.filter(x => x !== f.id);
        if (!f.leased) S.cash += val;
        S.fleet = S.fleet.filter(x => x !== f);
        save(); syncGlobe(); refreshSheet();
      };
      list.appendChild(row);
    }
    body.querySelector('#fMarket').onclick = () => openMarket();
  });
}

let marketTab = 'new';
function openMarket(tab) {
  if (tab) marketTab = tab;
  openSheet('market', body => {
    body.innerHTML = `<h3>Uçak pazarı</h3>
      <div class="tabs"><button data-t="new" class="${marketTab === 'new' ? 'on' : ''}">Sıfır</button><button data-t="used" class="${marketTab === 'used' ? 'on' : ''}">İkinci el</button></div>
      <div class="meta">${marketTab === 'new'
        ? 'Kiralama: başlangıçta 1 aylık kira, sonra günlük kira. Satın alma: peşin ödeme, düşük bakım gideri.'
        : `Ucuz ama yaşlı uçaklar: daha çok yakıt yakar, bakımı pahalıdır, itibarı düşürebilir. Liste ${14 - (S.day - (S.usedDay || 0))} gün sonra yenilenir.`}</div>
      <div class="list" id="mList"></div>
      <div class="row"><button id="mBack" class="ghost">Filoya dön</button></div>`;
    body.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { marketTab = b.dataset.t; refreshSheet(); });
    const list = body.querySelector('#mList');
    if (marketTab === 'new') {
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
    } else {
      if (!S.used || !S.used.length) list.innerHTML = '<p class="meta">Şu an ikinci el uçak yok. Liste yakında yenilenecek.</p>';
      for (const u of S.used || []) {
        const ac = AC[u.type], deposit = u.leaseDay * 30;
        const row = document.createElement('div');
        row.className = 'item';
        row.style.flexWrap = 'wrap';
        row.innerHTML = `<div class="grow"><div class="t">${ac.maker} ${ac.name} <span class="s">${2027 + Math.floor(S.day / 365) - Math.round(u.age / 365)} üretimi</span></div>
          <div class="s">${(u.age / 365).toFixed(1).replace('.', ',')} yaş · durum %${u.cond} · ${ac.seats} koltuk</div>
          <div class="s">Kira ${money(u.leaseDay)}/gün <span class="pos">(sıfırı ${money(sim.leasePerDay(ac))})</span> · fiyat ${money(u.price)} <span class="pos">(sıfırı ${money(ac.price * 1e6)})</span></div></div>
          <div style="display:flex;gap:6px"><button class="sm" data-a="lease" ${S.cash < deposit ? 'disabled' : ''}>Kirala ${money(deposit)}</button>
          <button class="sm" data-a="buy" ${S.cash < u.price ? 'disabled' : ''}>Satın al</button></div>`;
        row.querySelector('[data-a=lease]').onclick = () => acquire(ac, true, deposit, u);
        row.querySelector('[data-a=buy]').onclick = () => acquire(ac, false, u.price, u);
        list.appendChild(row);
      }
    }
    body.querySelector('#mBack').onclick = openFleet;
  });
}

function acquire(ac, leased, cost, used = null) {
  if (S.cash < cost) return toast('Kasada yeterli para yok.', 'error');
  S.cash -= cost;
  const f = { id: 'F' + S.seq++, type: ac.id, leased, reg: nextReg(), route: null, age: used ? used.age : 0, cond: used ? used.cond : 100 };
  if (used && leased) f.leaseDay = used.leaseDay;
  if (used) S.used = S.used.filter(x => x !== used);
  S.fleet.push(f);
  fx('buy'); floatText('−' + money(cost), { good: false });
  save(); updateHUD(true); refreshSheet();
  toast(`${ac.name} (${f.reg}) filona katıldı${leased ? ' (kiralık)' : ''}${used ? ', ikinci el' : ''}.`);
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
        updateHUD(true); refreshSheet();
        fx('fanfare');
        const items = [t.desc];
        if (planes) items.push('Yeni uçaklar: ' + planes);
        const ups = P.UPGRADES.filter(u => u.tier === t.id).map(u => u.name).concat(P.MANAGERS.filter(m => m.tier === t.id).map(m => m.name));
        if (ups.length) items.push('Açılanlar: ' + ups.join(', '));
        hideSheet();
        celebrate({ tag: 'Yeni lisans', title: `${t.name} lisansı`, text: `${S.name} artık ${t.name.toLocaleLowerCase('tr-TR')} bir havayolu.`, items, button: 'Haritaya dön' }).then(() => {
          if (t.id === 2) { const b = AP[S.bases[0]]; globe.flyTo(b.lat, b.lon, 4.3); }
          if (t.id === 3) globe.flyTo(45, 25, 3.2);
          if (t.id === 4) globe.flyTo(30, 30, 1.6);
        });
      };
      list.appendChild(row);
    }
  }
}

// ---------- Gelişim paneli ----------
let growthTab = 'goals';
const GROWTH_TABS = [['goals', 'Görevler'], ['deals', 'Sözleşmeler'], ['upgrades', 'Yükseltmeler'], ['auto', 'Otomasyon'], ['license', 'Lisans'], ['holding', 'Holding']];
function openGrowth(tab) {
  if (tab) growthTab = tab;
  selRoute = null; selAirport = null;
  openSheet('license', body => {
    const gs = P.goalState(S);
    body.innerHTML = `<h3>Gelişim</h3>
      <div class="tabs">${GROWTH_TABS.map(([k, l]) => `<button data-t="${k}" class="${k === growthTab ? 'on' : ''}">${l}${(k === 'goals' && gs.claimable) || (k === 'deals' && (S.offers || []).length) ? '<i class="dot"></i>' : ''}</button>`).join('')}</div>
      <div id="gBody"></div>`;
    body.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { growthTab = b.dataset.t; refreshSheet(); });
    const gb = body.querySelector('#gBody');
    ({ goals: renderGoals, deals: renderDeals, upgrades: renderUpgrades, auto: renderAuto, license: renderLicense, holding: renderHolding })[growthTab](gb);
  });
}

function renderGoals(body) {
  const gs = P.goalState(S);
  body.innerHTML = `${scenarioBox()}<div class="meta">Tamamlanan görevler: <b>${gs.doneCount} / ${gs.total}</b></div>
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
      if (r) { fx('goal'); floatText('+' + money(r), { big: true }); pulse('cash'); toast(`Görev tamamlandı: +${money(r)}`); save(); updateHUD(); refreshSheet(); }
    };
    list.appendChild(row);
  }
}

// ---------- Sözleşmeler ----------
const KIND_ICON = { seats: '🎟️', cargo: '📦', pax: '📣' };
function contractProgress(c) {
  if (c.kind === 'seats') return { cur: c.prog, max: c.days, label: `${c.prog} / ${c.days} gün · aksama ${c.strikes}/${X.MAX_STRIKES}` };
  const unit = c.kind === 'cargo' ? 'ton' : 'yolcu';
  return { cur: Math.min(c.prog, c.need), max: c.need, label: `${num(c.prog)} / ${num(c.need)} ${unit} · ${Math.max(0, c.end - S.day)} gün kaldı` };
}
function routeContracts(r) {
  const cs = (S.contracts || []).filter(c => (c.a && sim.pairKey(c.a, c.b) === sim.pairKey(r.a, r.b)) || c.ap === r.a || c.ap === r.b);
  if (!cs.length) return '';
  return `<h4>Bu hattaki sözleşmeler</h4><div class="list">${cs.map(c => { const p = contractProgress(c); return `
    <div class="item" style="flex-direction:column;align-items:stretch"><div class="t">${KIND_ICON[c.kind]} ${esc(c.title)}</div>
    <div class="s">${p.label}${c.kind === 'seats' ? ` · gereken ${num(c.need)} koltuk/yön, şu an ${num(X.routeSeats(S, r))}` : ''}</div>
    <div class="progress"><div style="width:${p.cur / p.max * 100}%"></div></div></div>`; }).join('')}</div>`;
}
function renderDeals(body) {
  const offers = S.offers || [], active = S.contracts || [], log = (S.contractLog || []).slice(-8).reverse();
  const full = active.length >= X.MAX_CONTRACTS;
  body.innerHTML = `<div class="meta">Tur şirketleri, kargo firmaları ve şehirler sana anlaşma teklif eder. Teklifler ${X.OFFER_DAYS} gün içinde düşer. Aynı anda en fazla ${X.MAX_CONTRACTS} sözleşme yürütebilirsin.</div>
    <h4>Süren sözleşmeler (${active.length}/${X.MAX_CONTRACTS})</h4><div class="list" id="dActive"></div>
    <h4>Teklifler</h4><div class="list" id="dOffers"></div>
    ${log.length ? `<h4>Geçmiş</h4><div class="list">${log.map(l => `<div class="item" style="min-height:0"><div class="grow"><div class="t">${l.ok ? '✓' : '✗'} ${esc(l.title)}</div><div class="s">Gün ${l.day}</div></div><div class="r ${l.ok ? 'pos' : 'neg'}">${l.reward ? money(l.reward) : '—'}</div></div>`).join('')}</div>` : ''}`;
  const al = body.querySelector('#dActive');
  if (!active.length) al.innerHTML = '<p class="meta">Süren sözleşme yok.</p>';
  for (const c of active) {
    const p = contractProgress(c);
    const row = document.createElement('div');
    row.className = 'item'; row.style.flexDirection = 'column'; row.style.alignItems = 'stretch';
    const r = c.a ? X.routeOn(S, c.a, c.b) : null;
    row.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px"><div class="t">${KIND_ICON[c.kind]} ${esc(c.title)}</div><div class="r pos">${money(c.reward)}</div></div>
      <div class="s">${esc(c.client)} · ${esc(c.text)}</div>
      <div class="s">${p.label}${c.kind === 'seats' ? ` · şu an ${num(X.routeSeats(S, r))} koltuk/yön` : ''}</div>
      <div class="progress"><div style="width:${p.cur / p.max * 100}%"></div></div>
      ${c.kind === 'seats' && !r ? '<p class="warn" style="margin-top:6px">Bu hat henüz yok: hemen aç, yoksa her gün aksama sayılır.</p>' : ''}
      ${r ? '<button class="sm" style="margin-top:8px;align-self:flex-start">Hatta git</button>' : ''}`;
    const b = row.querySelector('button'); if (b) b.onclick = () => openRoute(r);
    al.appendChild(row);
  }
  const ol = body.querySelector('#dOffers');
  if (!offers.length) ol.innerHTML = '<p class="meta">Şu an teklif yok. Ağın büyüdükçe birkaç günde bir yeni teklif gelir.</p>';
  for (const o of offers) {
    const row = document.createElement('div');
    row.className = 'item'; row.style.flexDirection = 'column'; row.style.alignItems = 'stretch';
    row.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px"><div class="t">${KIND_ICON[o.kind]} ${esc(o.title)}</div><div class="r pos">${money(o.reward)}</div></div>
      <div class="s">${esc(o.client)} · ${esc(o.text)}</div>
      <div class="s">${o.penalty ? `Başaramazsan ceza ${money(o.penalty)}` : 'Cezası yok'} · teklif ${Math.max(0, o.expires - S.day)} gün daha geçerli</div>
      <div style="display:flex;gap:6px;margin-top:8px"><button class="sm primary" data-a="ok" ${full ? 'disabled' : ''}>Kabul et</button><button class="sm" data-a="no">Reddet</button></div>`;
    row.querySelector('[data-a=ok]').onclick = () => {
      const c = X.acceptOffer(S, o.id);
      if (!c) return toast('En fazla 3 sözleşme yürütebilirsin.', 'error');
      fx('buy'); toast(`Sözleşme imzalandı: ${c.title}`); save(); refreshSheet(); updateGrowthDot();
    };
    row.querySelector('[data-a=no]').onclick = () => { X.declineOffer(S, o.id); save(); refreshSheet(); updateGrowthDot(); };
    ol.appendChild(row);
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
    if (b) b.onclick = () => { if (P.buyUpgrade(S, u.id)) { fx('buy'); floatText('−' + money(cost), { good: false }); toast(`${u.name} seviye ${L + 1}`); save(); updateHUD(); syncGlobe(); refreshSheet(); } };
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
      else if (P.hireManager(S, m.id)) { fx('buy'); toast(`${m.name} işe alındı.`); }
      save(); updateHUD(); refreshSheet();
    };
    list.appendChild(row);
  }
}

let holdPath = null;
function renderHolding(body) {
  if (S.daily) { body.innerHTML = '<p class="meta">Günün görevinde Holding kurulamaz.</p>'; return; }
  const st = P.starsFor(S), have = P.legacyStars(S), can = P.canPrestige(S);
  const cur = sim.pathOf(S);
  if (!holdPath) holdPath = cur.id;
  body.innerHTML = `<div class="meta">Holding kurduğunda şirketin sıfırdan başlar ama kazandığın yıldızlar kalıcıdır.</div>
    <div class="grid2">
      <div class="kv"><div class="k">Senin payının değeri</div><div class="v">${money(P.ownerValue(S))}</div></div>
      <div class="kv"><div class="k">Kazanacağın yıldız</div><div class="v">★ ${st}</div></div>
      <div class="kv"><div class="k">Sahip olduğun yıldız</div><div class="v">★ ${have}</div></div>
      <div class="kv"><div class="k">Kurulan holding</div><div class="v">${(S.legacy && S.legacy.count) || 0}</div></div>
    </div>
    <p class="meta" style="margin-top:10px">Şu anki bonusun: ${P.prestigeText(have)}.<br>Holding sonrası: ${P.prestigeText(have + st)}.</p>
    <p class="meta">Sıfırlananlar: kasa, filo, hatlar, üsler, slotlar, krediler, hisseler, lisans, yükseltmeler, müdürler, görevler, rakipler. Kalanlar: yıldızlar, rozetler, havayolu adın ve kimliğin.</p>
    <h4>Holding yolu</h4>
    <p class="meta">Şu anki yolun: <b>${cur.icon} ${cur.name}</b>. Yeni şirketin hangi stratejiyle başlasın? Her Holding'de yeniden seçebilirsin.</p>
    <div class="paths" id="hPaths">${Object.values(sim.PATHS).map(p => `<button data-p="${p.id}" class="${p.id === holdPath ? 'on' : ''}"><div class="pt">${p.icon} ${p.name}</div><div class="pd">${p.desc}</div></button>`).join('')}</div>
    ${can ? '' : '<p class="warn">Holding kurmak için en az Kıtasal lisans ve 1 yıldızlık şirket değeri ($25M) gerekir.</p>'}
    <div class="row"><button id="btnPrestige" class="primary" ${can ? '' : 'disabled'}>Holding kur ve yeniden başla (★ +${st})</button></div>`;
  body.querySelectorAll('#hPaths button').forEach(b => b.onclick = () => { holdPath = b.dataset.p; refreshSheet(); });
  body.querySelector('#btnPrestige').onclick = () => {
    if (!P.canPrestige(S)) return;
    if (!confirm(`Holding kurulsun mu? Şirketin sıfırlanacak, ★ ${st} yıldız kazanacaksın. Bu geri alınamaz.`)) return;
    const path = sim.PATHS[holdPath] || sim.PATHS.none;
    const legacy = { count: ((S.legacy && S.legacy.count) || 0) + 1, stars: have + st, path: path.id };
    const ns = newState(S.name, S.firstBase || S.bases[0], legacy);
    ns.badges = { ...(S.badges || {}) };
    ns.brand = S.brand;
    holdPath = null;
    ns.cash += 1e6 * legacy.stars;
    ns.firstBase = S.firstBase || S.bases[0];
    startGame(ns);
    save();
    fx('fanfare');
    celebrate({ tag: 'Holding', title: `★ ${legacy.stars} yıldız`, text: `${S.name} holdinge dönüştü. Yeni şirketin daha güçlü başlıyor.`, items: [P.prestigeText(legacy.stars), `Yol: ${path.icon} ${path.name}. ${path.desc}`], button: 'Yeniden başla' });
  };
}

let reportTab = 'sum';
function openReport(tab) {
  if (tab) reportTab = tab;
  openSheet('report', body => {
    body.innerHTML = `<h3>Rapor</h3><div class="meta">Gün ${S.day} · ${S.fleet.length} uçak · ${S.routes.length} rota</div>
      <div class="tabs">${[['sum', 'Özet'], ['stats', 'Grafikler'], ['fin', 'Finans'], ['svc', 'Hizmet'], ['badges', 'Rozetler']].map(([k, l]) => `<button data-t="${k}" class="${k === reportTab ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="repBody"></div>`;
    body.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { reportTab = b.dataset.t; refreshSheet(); });
    ({ sum: renderSummary, stats: renderStats, fin: renderFinance, svc: renderService, badges: renderBadges })[reportTab](body.querySelector('#repBody'));
  });
}

function renderSummary(body) {
  const last = S.history[S.history.length - 1];
  const hist = S.history.slice(-30);
  const fixed = S.fleet.reduce((s, f) => s + sim.playerFixed(S, f), 0);
  body.innerHTML = `${last ? `<div class="grid2">
      <div class="kv"><div class="k">Dünkü gelir</div><div class="v">${money(last.revenue)}</div></div>
      <div class="kv"><div class="k">Dünkü gider</div><div class="v">${money(last.cost)}</div></div>
      <div class="kv"><div class="k">Dünkü kâr</div><div class="v ${sign(last.profit)}">${money(last.profit)}</div></div>
      <div class="kv"><div class="k">Dünkü yolcu</div><div class="v">${num(last.pax)}</div></div>
      ${last.cargo ? `<div class="kv"><div class="k">Kargo · gelir</div><div class="v">${num(last.cargo)} t · ${money(last.cargoRev)}</div></div>` : ''}
      ${last.tpax ? `<div class="kv"><div class="k">Aktarmalı yolcu</div><div class="v">${num(last.tpax)}</div></div>` : ''}
      ${last.interest ? `<div class="kv"><div class="k">Kredi faizi</div><div class="v neg">${money(last.interest)}</div></div>` : ''}
      ${last.div ? `<div class="kv"><div class="k">Temettü</div><div class="v neg">${money(last.div)}</div></div>` : ''}
    </div>` : '<p class="meta">İlk gün henüz bitmedi. Gün sonunda (00:00) hesap yapılır.</p>'}
    <h4>Son ${hist.length} günün kârı</h4>
    ${barChart({ values: hist.map(h => h.profit), labels: hist.map(h => dayLbl(h.day)), height: 70 })}
    <p class="meta" style="margin-top:6px">Daha fazla grafik ve rekorlar <b>Grafikler</b> sekmesinde.</p>
    <h4>Sabit giderler (günlük)</h4>
    <div class="grid2">
      <div class="kv"><div class="k">Uçak kira/bakım</div><div class="v">${money(fixed)}</div></div>
      <div class="kv"><div class="k">Genel gider</div><div class="v">${money(sim.overheadPerDay(S))}</div></div>
    </div>
    <p class="meta" style="margin-top:6px">Genel giderde uçak başına yönetim payı ${money(sim.orgPerPlane(S.fleet.length))}/gün. Filo büyüdükçe bu pay artar.</p>
    ${(S.transfers || []).length ? `<h4>En çok aktarma yapılan yollar</h4><div class="list">${S.transfers.slice(0, 6).map(f => `
      <div class="item" style="min-height:0"><div class="grow"><div class="t">${AP[f.x].n} → ${AP[f.y].n}</div><div class="s">${AP[f.h].n} üzerinden</div></div><div class="r">${num(f.pax)}<div class="s">yolcu/gün</div></div></div>`).join('')}</div>`
      : `<p class="meta" style="margin-top:12px">Aktarmalı yolcu yok. Bir üssünden iki farklı yöne hat aç: uçları arasında seyahat edenler üssünde aktarma yapar.</p>`}
    <h4>Rotalar</h4><div class="list" id="repRoutes"></div>`;
  const sorted = [...S.routes].sort((x, y) => (y.last?.net ?? 0) - (x.last?.net ?? 0));
  routeList(body.querySelector('#repRoutes'), sorted);
  bindCharts(body, FMTS);
}

// ---------- Rozetler ----------
function renderBadges(body) {
  const got = S.badges || {}, n = Object.keys(got).length;
  body.innerHTML = `<div class="meta">Kazandığın rozetler: <b>${n} / ${X.BADGES.length}</b>. Rozetler Holding kurunca da kalır.</div>
    <div class="progress" style="margin-bottom:12px"><div style="width:${n / X.BADGES.length * 100}%"></div></div>
    <div class="bdgs">${X.BADGES.map(b => `<div class="bdg ${got[b.id] != null ? 'on' : ''}"><div class="bi">${got[b.id] != null ? b.icon : '🔒'}</div>
      <div class="bn">${b.name}</div><div class="bt">${b.text}</div>${got[b.id] != null ? `<div class="bd">Gün ${got[b.id]}</div>` : ''}</div>`).join('')}</div>`;
}

let statRange = 90;
function renderStats(body) {
  const hist = S.history.slice(-statRange);
  const labels = hist.map(h => dayLbl(h.day));
  const R = S.records || {};
  const sorted = [...hist].sort((a, b) => b.profit - a.profit);
  const best = sorted.slice(0, 3), worst = sorted.slice(-3).reverse().filter(h => !best.includes(h));
  const sum = hist.reduce((a, h) => ({ rev: a.rev + h.revenue, prof: a.prof + h.profit, pax: a.pax + h.pax }), { rev: 0, prof: 0, pax: 0 });
  const dayRow = h => `<div class="item" style="min-height:0"><div class="grow"><div class="t">Gün ${h.day}</div><div class="s">${num(h.pax)} yolcu · gelir ${money(h.revenue)}</div></div><div class="r ${sign(h.profit)}">${money(h.profit)}</div></div>`;
  const routes = [...S.routes].filter(r => (r.hist || []).length).map(r => {
    const h = r.hist.slice(-30); return { r, avg: h.reduce((s, x) => s + x.net, 0) / h.length, trend: h.map(x => x.net) };
  }).sort((a, b) => b.avg - a.avg);
  body.innerHTML = `<div class="tabs" id="stRange">${[[30, '30 gün'], [90, '90 gün'], [365, '1 yıl']].map(([d, l]) => `<button data-d="${d}" class="${d === statRange ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${hist.length < 2 ? '<p class="meta">Grafikler birkaç gün sonra dolmaya başlar.</p>' : `
    <div class="grid2">
      <div class="kv"><div class="k">Toplam kâr (${hist.length} gün)</div><div class="v ${sign(sum.prof)}">${money(sum.prof)}</div></div>
      <div class="kv"><div class="k">Ortalama günlük kâr</div><div class="v ${sign(sum.prof)}">${money(sum.prof / hist.length)}</div></div>
      <div class="kv"><div class="k">Toplam gelir</div><div class="v">${money(sum.rev)}</div></div>
      <div class="kv"><div class="k">Taşınan yolcu</div><div class="v">${num(sum.pax)}</div></div>
    </div>
    <h4>Günlük kâr</h4>${barChart({ values: hist.map(h => h.profit), labels })}
    <h4>Kasa</h4>${lineChart({ series: [{ values: hist.map(h => h.cash ?? null), color: '#ffd166', fill: true, label: 'kasa' }], labels, fmt: FMTS.money })}
    <h4>Gelir ve gider</h4>${lineChart({ series: [{ values: hist.map(h => h.revenue), color: '#06d6a0', label: 'gelir' }, { values: hist.map(h => h.cost), color: '#ef476f', label: 'gider' }], labels, fmt: FMTS.money, zero: true })}
    <div class="legend"><span style="--c:#06d6a0">Gelir</span><span style="--c:#ef476f">Gider</span></div>
    <h4>Günlük yolcu</h4>${lineChart({ series: [{ values: hist.map(h => h.pax), color: '#4cc9f0', fill: true, label: 'yolcu' }].concat(hist.some(h => h.tpax) ? [{ values: hist.map(h => h.tpax || 0), color: '#c77dff', label: 'aktarma' }] : []), labels, fmt: FMTS.num, zero: true })}
    ${hist.some(h => h.mshare != null) && (S.rivals || []).some(rv => rv.active) ? `<h4>Toplam pazar payın</h4><div class="meta">Senin yolcun ÷ (sen + tüm rakipler)</div>${lineChart({ series: [{ values: hist.map(h => h.mshare ?? null), color: '#ffd166', fill: true, label: 'pay' }], labels, fmt: FMTS.pctf, min: 0, max: Math.min(1, Math.max(0.2, ...hist.map(h => h.mshare || 0)) * 1.15) })}` : ''}
    <h4>En iyi günler</h4><div class="list">${best.map(dayRow).join('')}</div>
    ${worst.length ? `<h4>En kötü günler</h4><div class="list">${worst.map(dayRow).join('')}</div>` : ''}`}
    <h4>Tüm zamanların rekorları</h4>
    <div class="grid2">
      <div class="kv"><div class="k">En kârlı gün${R.profit ? ` (${R.profit.day}. gün)` : ''}</div><div class="v pos">${R.profit ? money(R.profit.v) : '—'}</div></div>
      <div class="kv"><div class="k">En çok yolcu${R.pax ? ` (${R.pax.day}. gün)` : ''}</div><div class="v">${R.pax ? num(R.pax.v) : '—'}</div></div>
      <div class="kv"><div class="k">En yüksek kasa</div><div class="v">${R.cash ? money(R.cash.v) : '—'}</div></div>
      <div class="kv"><div class="k">Toplam yolcu</div><div class="v">${num(S.totalPax)}</div></div>
    </div>
    ${routes.length ? `<h4>Hatlar (son 30 gün ortalaması)</h4><div class="list" id="stRoutes">${routes.map(({ r, avg, trend }) => `
      <button class="item" data-r="${esc(r.id)}"><span class="swatch" style="background:${esc(r.color)}"></span>
        <div class="grow"><div class="t">${esc(r.a)} ⇄ ${esc(r.b)}</div>${spark(trend)}</div>
        <div class="r ${sign(avg)}">${money(avg)}<div class="s">/gün</div></div></button>`).join('')}</div>` : ''}`;
  body.querySelectorAll('#stRange button').forEach(b => b.onclick = () => { statRange = Number(b.dataset.d); refreshSheet(); });
  body.querySelectorAll('#stRoutes [data-r]').forEach(b => b.onclick = () => { const r = S.routes.find(x => x.id === b.dataset.r); if (r) openRoute(r); });
  bindCharts(body, FMTS);
}

// Küçük eğilim çizgisi
function spark(vals) {
  if (vals.length < 2) return '';
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), rg = hi - lo || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * 100).toFixed(1)},${(22 - (v - lo) / rg * 20).toFixed(1)}`).join(' ');
  const z = 22 - (0 - lo) / rg * 20;
  return `<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none"><line x1="0" x2="100" y1="${z}" y2="${z}" stroke="rgba(255,255,255,0.15)" vector-effect="non-scaling-stroke"/><polyline points="${pts}" fill="none" stroke="${vals[vals.length - 1] >= 0 ? 'var(--good)' : 'var(--bad)'}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

let loanTerm = 360;
function renderFinance(body) {
  const v = P.valueParts(S), cv = P.companyValue(S), lim = D.creditLimit(S), fl = S.float || 0;
  const loans = S.loans || [];
  const pay = loans.reduce((s, l) => s + l.pay, 0);
  body.innerHTML = `<h4>Şirket değeri</h4>
    <div class="grid2">
      <div class="kv"><div class="k">Toplam değer</div><div class="v ${sign(cv)}">${money(cv)}</div></div>
      <div class="kv"><div class="k">Senin payın (%${Math.round((1 - fl) * 100)})</div><div class="v">${money(P.ownerValue(S))}</div></div>
      <div class="kv"><div class="k">Kasa</div><div class="v">${money(v.cash)}</div></div>
      <div class="kv"><div class="k">Sahipli uçaklar</div><div class="v">${money(v.owned)}</div></div>
      <div class="kv"><div class="k">Kârlılık (180 gün)</div><div class="v">${money(v.earnings)}</div></div>
      <div class="kv"><div class="k">Borç</div><div class="v ${v.debt ? 'neg' : ''}">${money(v.debt)}</div></div>
    </div>
    <h4>Banka kredisi</h4>
    <div class="grid2">
      <div class="kv"><div class="k">Kredi notu</div><div class="v">${D.rating(S)}</div></div>
      <div class="kv"><div class="k">Kullanılabilir limit</div><div class="v">${money(lim)}</div></div>
      <div class="kv"><div class="k">Yıllık faiz (${loanTerm} gün)</div><div class="v">%${(D.loanRate(S, loanTerm) * 100).toFixed(1)}</div></div>
      <div class="kv"><div class="k">Günlük taksitler</div><div class="v">${money(pay)}</div></div>
    </div>
    <div class="tabs" id="lnTerm" style="margin-top:10px">${D.LOAN_TERMS.map(t => `<button data-d="${t}" class="${t === loanTerm ? 'on' : ''}">${t} gün vade</button>`).join('')}</div>
    <div class="row" id="lnTake">${[0.25, 0.5, 1].map(p => { const a = Math.round(lim * p / 1e5) * 1e5; return `<button class="sm" data-a="${a}" ${a < 1e5 ? 'disabled' : ''}>${money(a)} çek</button>`; }).join('')}</div>
    <div class="list" id="lnList" style="margin-top:10px"></div>
    <p class="meta" style="margin-top:8px">Taksitler her gün kasadan düşer. Borcun şirket değerine oranı arttıkça faiz yükselir. Kredini istediğin zaman kapatabilirsin.</p>
    <h4>Hisse senedi</h4>
    ${fl ? `<div class="grid2">
      <div class="kv"><div class="k">Halka açık pay</div><div class="v">%${Math.round(fl * 100)}</div></div>
      <div class="kv"><div class="k">Hisse fiyatı</div><div class="v">$${D.sharePrice(S).toFixed(2)}</div></div></div>` : ''}
    <p class="meta" style="margin-top:8px">${D.canIPO(S) || fl ? `%10'luk dilimlerle en fazla %${D.MAX_FLOAT * 100} satabilirsin. Ortaklar her gün kârın %${D.DIVIDEND * 100}'i × paylarını temettü olarak alır. Holding yıldızların senin payına göre hesaplanır.`
      : 'Halka arz için Ulusal lisans ve en az $20M şirket değeri gerekir.'}</p>
    <div class="row">
      <button class="sm" id="shSell" ${D.canIPO(S) && fl < D.MAX_FLOAT - 1e-9 ? '' : 'disabled'}>${fl ? '%10 daha sat' : 'Halka arz: %10 sat'} (+${money(D.sellValue(S))})</button>
      <button class="sm" id="shBuy" ${fl > 0 && S.cash >= D.buyBackCost(S) ? '' : 'disabled'}>%10 geri al (${money(D.buyBackCost(S))})</button>
    </div>`;
  body.querySelectorAll('#lnTerm button').forEach(b => b.onclick = () => { loanTerm = Number(b.dataset.d); refreshSheet(); });
  body.querySelectorAll('#lnTake button').forEach(b => b.onclick = () => {
    const amt = Number(b.dataset.a), rate = D.loanRate(S, loanTerm);
    if (!confirm(`${money(amt)} kredi, ${loanTerm} gün vade, yıllık %${(rate * 100).toFixed(1)} faiz. Günlük taksit ${money(D.loanPayment(amt, rate, loanTerm))}. Onaylıyor musun?`)) return;
    const l = D.takeLoan(S, amt, loanTerm);
    if (l) { fx('coin'); floatText('+' + money(l.amount)); toast(`Kredi alındı: +${money(l.amount)}`); save(); updateHUD(); refreshSheet(); }
  });
  const ll = body.querySelector('#lnList');
  for (const l of loans) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<div class="grow"><div class="t">${money(l.amount)} kredi · %${(l.rate * 100).toFixed(1)}</div>
      <div class="s">Kalan borç ${money(l.principal)} · ${l.left} gün · taksit ${money(l.pay)}/gün</div></div>
      <button class="sm" ${S.cash < l.principal ? 'disabled' : ''}>Kapat</button>`;
    row.querySelector('button').onclick = () => { if (D.repayLoan(S, l.id)) { S.loansRepaid = (S.loansRepaid || 0) + 1; toast('Kredi kapatıldı.'); save(); updateHUD(); refreshSheet(); } };
    ll.appendChild(row);
  }
  body.querySelector('#shSell').onclick = () => {
    const val = D.sellValue(S);
    if (!confirm(`Şirketin %10'u ${money(val)} karşılığında satılsın mı? Ortaklar kârdan temettü alır ve holding yıldızların payına göre azalır.`)) return;
    const got = D.sellShares(S);
    if (got) { fx('coin'); floatText('+' + money(got)); toast(`${(S.float || 0) <= 0.1 ? 'Halka arz tamamlandı' : 'Hisse satıldı'}: +${money(got)}`); save(); updateHUD(); refreshSheet(); checkGoals(); }
  };
  body.querySelector('#shBuy').onclick = () => {
    const c = D.buyBack(S);
    if (c) { toast(`%10 hisse geri alındı (${money(c)}).`); save(); updateHUD(); refreshSheet(); }
  };
}

function renderService(body) {
  const cur = S.service ?? 1, q = sim.fleetQuality(S), rep = sim.playerRep(S);
  body.innerHTML = `<div class="meta">Hizmet kalitesi itibarını (rakiplere karşı pazar payı) ve business yolcu talebini etkiler. Yolcu başına maliyeti vardır.</div>
    <div class="grid2">
      <div class="kv"><div class="k">Toplam itibar</div><div class="v ${sign(rep - 1)}">${rep >= 1 ? '+' : '−'}%${Math.round(Math.abs(rep - 1) * 100)}</div></div>
      <div class="kv"><div class="k">Filo yaşı ve durumu</div><div class="v ${sign(q - 1 + 1e-9)}">${q >= 0.999 ? 'iyi' : '−%' + Math.round((1 - q) * 100)}</div></div>
    </div>
    <h4>İkram ve kabin hizmeti</h4><div class="list" id="svcList"></div>`;
  const list = body.querySelector('#svcList');
  sim.SERVICE.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'item';
    if (i === cur) b.style.borderColor = 'var(--accent)';
    b.innerHTML = `<div class="grow"><div class="t">${i === cur ? '✓ ' : ''}${s.name}</div><div class="s">${s.desc}</div>
      <div class="s">İtibar ${s.rep >= 1 ? '+' : '−'}%${Math.round(Math.abs(s.rep - 1) * 100)} · business talebi ×${s.biz}</div></div>
      <div class="r">${s.cost > 0 ? '+$' + s.cost : s.cost < 0 ? '−$' + -s.cost : '$0'}<div class="s">yolcu başına</div></div>`;
    b.onclick = () => { S.service = i; save(); toast(`Hizmet seviyesi: ${s.name}`); refreshSheet(); };
    list.appendChild(b);
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
  const br = ID.brandOf(S);
  $('airlineName').textContent = `${br.logo} ${S.name}${S.daily ? ` · Günün görevi ${S.day}/${S.daily.days}` : ''}`;
  $('airlineName').style.color = br.color;
  updateHint();
}

function setSpeed(v) {
  speed = v;
  document.querySelectorAll('.speed button').forEach(x => x.classList.toggle('on', Number(x.dataset.speed) === v));
}
document.querySelectorAll('.speed button').forEach(b => b.onclick = () => setSpeed(Number(b.dataset.speed)));
// Klavye: boşluk duraklatır, 1-3 hız
window.addEventListener('keydown', e => {
  if (!S || S.over || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
  if (e.code === 'Space') { e.preventDefault(); setSpeed(speed ? 0 : (settings.speed || 1)); }
  else if (e.key === '1') setSpeed(1); else if (e.key === '2') setSpeed(4); else if (e.key === '3') setSpeed(16);
  else if (e.key === 'Escape') { if (panel) closeSheet(); else if (pickFrom) cancelPick(); }
});

let toastTimer = 0;
function toast(msg, sound) {
  if (sound) fx(sound);
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
  if (b) b.classList.toggle('has-dot', !!(S && (P.goalState(S).claimable || (S.offers || []).length)));
}

function showOffline(ms) {
  if (!S || S.over || S.daily) return;
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
    if (o.money > 0) { fx('coin'); floatText('+' + money(o.money), { big: true }); pulse('cash'); }
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
  const { rec, news, recs, badges, scenario } = G.advanceDay(S);
  if (scenario) setTimeout(() => showScenarioResult(scenario), 400);
  const daily = DY.checkDaily(S);
  if (daily) setTimeout(() => showDailyResult(daily), 400);
  pushNews(news);
  syncGlobe();
  save();
  if (panel && ['report', 'routes', 'license', 'fleet', 'rivals', 'news', 'route', 'airport', 'market'].includes(panel.name)) refreshSheet();
  if (S.pendingDecision && !$('decision').classList.contains('show')) { showDecision(); fx('notify'); }
  checkGoals();
  // Gün sonu geri bildirimi: kasanın yanında uçan kâr, rekorlar
  if (rec.pax || rec.profit) {
    floatText((rec.profit >= 0 ? '+' : '−') + money(Math.abs(rec.profit)).replace('−', ''), { good: rec.profit >= 0 });
    pulse('cash', rec.profit >= 0);
    if (speed <= 4) play(rec.profit >= 0 ? 'coin' : 'loss');
  }
  const imp = news.filter(n => n.important);
  const won = news.filter(n => n.kind === 'contract' && n.reward);
  if (won.length) { fx('goal'); floatText('+' + money(won.reduce((s, n) => s + n.reward, 0)), { big: true }); }
  if (badges.length) setTimeout(() => { fx('record'); confetti(60, cashPoint()); toast(`${badges[0].icon} Yeni rozet: ${badges[0].name}${badges.length > 1 ? ` (+${badges.length - 1})` : ''}`); }, recs.length ? 2500 : 300);
  if (recs.length) { fx('record'); confetti(70, cashPoint()); toast('🏆 ' + recs.join(' · ')); }
  else if (imp.length) { fx(imp.some(n => /^#(ef476f|e85d04|e63946|e76f51)/i.test(n.color || '')) ? 'bad' : 'notify'); toast(imp[0].text + (imp.length > 1 ? ` (+${imp.length - 1} haber daha, Haberler'e bak)` : '')); }
  else if (S.day % 7 === 0) toast(`Hafta özeti: dünkü kâr ${money(rec.profit)} · ${num(rec.pax)} yolcu`);
  if (S.cash < sim.BANKRUPT) gameOver();
}

const cashPoint = () => { const r = $('cash').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom }; };

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
  goalAcc += dt; if (goalAcc > 2) { goalAcc = 0; checkGoals(); checkTips(); }
  requestAnimationFrame(frame);
}

// ---------- Başlangıç ----------
function startGame(state) {
  S = state;
  S.rivals = S.rivals || []; S.news = S.news || []; S.events = S.events || [];
  S.upgrades = S.upgrades || {}; S.managers = S.managers || {}; S.goalsDone = S.goalsDone || []; S.goalsNotified = S.goalsNotified || [];
  S.firstBase = S.firstBase || S.bases[0];
  // v0.8 alanları (eski kayıtlar için)
  S.fleet.forEach(f => { if (f.age == null) f.age = 0; if (f.cond == null) f.cond = 100; });
  S.slots = S.slots || {}; S.loans = S.loans || []; S.float = S.float || 0;
  if (S.service == null) S.service = 1;
  S.contracts = S.contracts || []; S.offers = S.offers || []; S.badges = S.badges || {}; S.totalCargo = S.totalCargo || 0;
  if (!S.used) D.refreshUsed(S);
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
  setSpeed(settings.speed || 1);
  tipShown = null; hideTip();
  applyBrand();
}

function setupStart() {
  const ss = $('scenInput');
  const best = id => { const b = settings.scen && settings.scen[id]; return b ? ' ' + '★'.repeat(b.stars) + '☆'.repeat(3 - b.stars) : ''; };
  ss.innerHTML = SC.SCENARIOS.map(x => `<option value="${x.id}">${x.icon} ${x.name}${x.level ? ` (${x.level})` : ''}${best(x.id)}</option>`).join('');
  ss.onchange = () => {
    const sc = SC.SCENARIOS.find(x => x.id === ss.value);
    const b = settings.scen && settings.scen[sc.id];
    $('scenDesc').textContent = sc.desc + (sc.days ? ` Süre: ${sc.days} gün. Sürenin yarısında bitirirsen ★★★, dörtte üçünde ★★.` : '') + (b ? ` En iyi sonucun: ${b.day}. gün.` : '');
    $('baseInput').disabled = !!sc.base;
    if (sc.base) $('baseInput').value = sc.base;
  };
  const sel = $('baseInput');
  sel.innerHTML = AIRPORTS.filter(a => a.z === 'TR').sort((x, y) => y.p - x.p)
    .map(a => `<option value="${a.c}">${a.n} (${a.c})</option>`).join('');
  sel.value = 'IST';
  ss.value = 'free'; ss.onchange();
  renderDailyCard();
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
  const scId = $('scenInput').value, sc = SC.SCENARIOS.find(x => x.id === scId);
  const st = SC.applyScenario(newState(name, sc && sc.base ? sc.base : $('baseInput').value), scId);
  startGame(st);
  if (st.scenario) setTimeout(() => toast(`${sc.icon} ${sc.name}: ${sc.desc}`), 1200);
  save();
};
$('btnRestart').onclick = () => { $('gameover').classList.remove('show'); S = null; syncGlobe(); setupStart(); $('start').classList.add('show'); };

// ---------- Havayolu kimliği ----------
function applyBrand() {
  if (!S) return;
  traffic.setLivery(ID.liveryColors(ID.brandOf(S)));
  updateHUD();
}
function brandSection() {
  const b = ID.brandOf(S);
  return `<h4 id="brandSec">Havayolu</h4>
    <div class="list"><div class="item" style="flex-direction:column;align-items:stretch">
      <div class="plane-prev" id="brPrev">${ID.planeSvg(b)}</div>
      <label class="s" style="margin-top:6px">Ad<input id="brName" maxlength="24" value="${esc(S.name)}" style="margin-top:4px"></label>
      <div class="s" style="margin-top:10px">Renk</div>
      <div class="swatches" id="brColors">${ID.BRAND_COLORS.map(c => `<button data-c="${c}" class="${c === b.color ? 'on' : ''}" style="background:${c}" aria-label="Renk ${c}"></button>`).join('')}</div>
      <div class="s" style="margin-top:10px">Logo</div>
      <div class="swatches logos" id="brLogos">${ID.LOGOS.map(l => `<button data-l="${l}" class="${l === b.logo ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="s" style="margin-top:10px">Uçak boyası</div>
      <div class="tabs" id="brLivery" style="margin-top:6px">${ID.LIVERIES.map(l => `<button data-v="${l.id}" class="${l.id === b.livery ? 'on' : ''}" title="${l.desc}">${l.name}</button>`).join('')}</div>
    </div></div>`;
}
function bindBrand(body) {
  const set = patch => { S.brand = { ...ID.brandOf(S), ...patch }; save(); applyBrand(); syncGlobe(); refreshSheet(); };
  body.querySelectorAll('#brColors button').forEach(x => x.onclick = () => set({ color: x.dataset.c }));
  body.querySelectorAll('#brLogos button').forEach(x => x.onclick = () => set({ logo: x.dataset.l }));
  body.querySelectorAll('#brLivery button').forEach(x => x.onclick = () => set({ livery: x.dataset.v }));
  const nm = body.querySelector('#brName');
  nm.onchange = () => { const v = nm.value.replace(/[<>"`]/g, '').trim().slice(0, 24); if (v) { S.name = v; S.brand = ID.brandOf(S); save(); updateHUD(); } };
}

// ---------- Ana menü ve günün görevi ----------
function toMenu() {
  save();
  S = null; closeSheet(); hideTip(); syncGlobe(); updateMarkers();
  $('celebrate').classList.remove('show');
  setupStart(); $('start').classList.add('show');
}
function renderDailyCard() {
  const box = $('dailyBox');
  const def = DY.dailyDef();
  let run = loadSave(DAILY_KEY);
  if (run && (!run.daily || run.daily.key !== def.key || run.daily.done)) { try { localStorage.removeItem(DAILY_KEY); } catch (_) { /* yok */ } run = null; }
  const best = settings.daily && settings.daily[def.key];
  box.innerHTML = `<div class="daily-card"><div class="dt">📅 Günün görevi · ${DY.dateLabel(def.key)}</div>
    <div class="ds">${DY.describeDaily(def)}${best ? `<br><b>Bugünkü en iyi puanın: ${money(best)}</b>` : ''}</div>
    <button class="big" id="btnDaily">${run ? `Devam et (gün ${run.day}/${run.daily.days})` : best ? 'Yeniden dene' : 'Başla'}</button></div>`;
  box.querySelector('#btnDaily').onclick = () => {
    if (run) return startGame(run);
    const name = $('nameInput').value.trim() || 'Anadolu Kanatları';
    const st = DY.newDaily(name, def);
    const main = loadSave();
    if (main && main.brand) st.brand = main.brand;
    startGame(st); save();
    setTimeout(() => toast(`📅 Günün görevi: ${DY.DAILY_DAYS} gün. Puanın, son gündeki şirket değerin.`), 1200);
  };
}
function showDailyResult(r) {
  settings.daily = settings.daily || {};
  const key = S.daily.key, old = settings.daily[key];
  const rec = !old || r.score > old;
  if (rec) settings.daily[key] = r.score;
  // Son 14 günü tut
  const keys = Object.keys(settings.daily).sort();
  while (keys.length > 14) delete settings.daily[keys.shift()];
  saveSettings();
  fx(rec ? 'fanfare' : 'goal'); hideSheet();
  try { localStorage.removeItem(DAILY_KEY); } catch (_) { /* yok */ }
  const hist = Object.entries(settings.daily).filter(([k]) => k !== key).sort().slice(-5).map(([k, v]) => `${DY.dateLabel(k)}: ${money(v)}`);
  celebrate({ tag: 'Günün görevi bitti', title: money(r.score), text: rec ? (old ? `Yeni rekor! Önceki en iyin ${money(old)}.` : 'Bugünkü ilk puanın.') : `Bugünkü en iyin ${money(old)}.`,
    items: [`${S.name} · ${S.routes.length} hat · ${S.fleet.length} uçak · ${num(S.totalPax)} yolcu`, ...hist.length ? ['Önceki günler: ' + hist.join(' · ')] : [], 'Yarın yeni bir görev gelir.'], button: 'Ana menü', party: rec })
    .then(() => { S.over = true; S = null; syncGlobe(); updateMarkers(); setupStart(); $('start').classList.add('show'); });
}

// ---------- Senaryo ----------
function scenarioBox() {
  const sc = SC.scenarioOf(S);
  if (!sc) return '';
  const st = S.scenario, parts = SC.scenarioProgress(S);
  const left = Math.max(0, sc.days - S.day);
  const fmtV = (p, v) => p.fmt ? p.fmt(v) : p.money ? money(v) : num(v);
  const head = st.won != null ? `<span class="pos">Tamamlandı: ${st.won}. gün</span> <span class="stars">${'★'.repeat(st.stars)}${'☆'.repeat(3 - st.stars)}</span>`
    : st.lost ? '<span class="neg">Süre doldu. Serbest oyun olarak devam ediyorsun.</span>'
    : `${left} gün kaldı · ★★★ için ${Math.max(0, Math.floor(sc.days * 0.5) - S.day)} gün`;
  return `<div class="scen-box"><div class="t">${sc.icon} ${sc.name}</div><div class="s">${head}</div>
    ${parts.map(p => `<div class="s" style="margin-top:8px">${p.label}: <b>${fmtV(p, p.cur)}</b> / ${fmtV(p, p.target)} ${p.done ? '✓' : ''}</div>
      <div class="progress"><div style="width:${Math.min(100, p.cur / p.target * 100)}%"></div></div>`).join('')}</div>`;
}
function showScenarioResult(r) {
  if (r.won) {
    settings.scen = settings.scen || {};
    const old = settings.scen[r.sc.id];
    if (!old || r.stars > old.stars || (r.stars === old.stars && S.day < old.day)) { settings.scen[r.sc.id] = { stars: r.stars, day: S.day }; saveSettings(); }
    fx('fanfare'); hideSheet();
    celebrate({ tag: 'Senaryo tamamlandı', title: `${r.sc.icon} ${r.sc.name}`, text: `${S.day}. günde bitirdin. ${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}`,
      items: [r.stars < 3 ? `★★★ için ${Math.floor(r.sc.days * 0.5)}. günden önce bitirmen gerekirdi.` : 'En yüksek puan!', 'İstersen serbest oyun olarak devam edebilirsin.'], button: 'Devam et' });
  } else {
    fx('bad'); hideSheet();
    celebrate({ tag: 'Süre doldu', title: `${r.sc.icon} ${r.sc.name}`, text: 'Hedefe yetişemedin.', party: false,
      items: SC.scenarioProgress(S).map(p => `${p.label}: ${p.fmt ? p.fmt(p.cur) : p.money ? money(p.cur) : num(p.cur)} / ${p.fmt ? p.fmt(p.target) : p.money ? money(p.target) : num(p.target)}`).concat(['Serbest oyun olarak devam edebilir ya da Ayarlar → Oyunu sıfırla ile yeniden deneyebilirsin.']), button: 'Devam et' });
  }
  save();
}
const applyCb = () => document.documentElement.classList.toggle('cb', !!settings.cb);
applyCb();

// ---------- Ayarlar ----------
function openSettings(focus) {
  selRoute = null; selAirport = null;
  openSheet('settings', body => {
    const tog = (k, label, desc) => `<label class="item check"><div class="grow"><div class="t">${label}</div>${desc ? `<div class="s">${desc}</div>` : ''}</div><input type="checkbox" data-k="${k}" ${settings[k] ? 'checked' : ''}></label>`;
    body.innerHTML = `<h3>Ayarlar</h3><div class="meta">SkyWeave ${VERSION} · ayarlar bu cihazda saklanır</div>
      ${S ? brandSection() : ''}
      <h4>Ses</h4>
      <div class="list">
        ${tog('sfx', 'Ses efektleri', 'Kalkış, para, rekor ve bildirim sesleri')}
        ${tog('music', 'Müzik', 'Sakin arka plan müziği')}
        <div class="item" style="flex-direction:column;align-items:stretch"><div class="t">Ses düzeyi <span class="s" id="volLbl">${pct(settings.volume)}</span></div>
          <input type="range" class="slider" id="setVol" min="0" max="100" step="5" value="${Math.round(settings.volume * 100)}"></div>
        ${'vibrate' in navigator ? tog('haptics', 'Titreşim', 'Satın alma, rekor ve uyarılarda kısa titreşim') : ''}
      </div>
      <h4>Oyun</h4>
      <div class="list">
        <div class="item"><div class="grow"><div class="t">Açılış hızı</div><div class="s">Oyun açıldığında bu hızla başlar. Klavyede boşluk duraklatır, 1–3 hızı seçer.</div></div>
          <div class="tabs" id="setSpeed" style="margin:0">${[1, 4, 16].map(v => `<button data-v="${v}" class="${settings.speed === v ? 'on' : ''}">${v}×</button>`).join('')}</div></div>
        ${tog('tips', 'İpuçları', 'Oyun ilerledikçe yeni sistemleri anlatan kartlar')}
        ${tog('cb', 'Renk körü dostu renkler', 'Kâr ve zarar yeşil/kırmızı yerine mavi/turuncu görünür')}
        <div class="item"><div class="grow"><div class="t">Dil</div><div class="s">Şimdilik yalnızca Türkçe.</div></div><b>Türkçe</b></div>
      </div>
      <div class="row"><button id="setGuide">Nasıl oynanır</button><button id="setTipsReset">İpuçlarını baştan göster</button></div>
      <h4>Kayıt</h4>
      <p class="meta">Oyun her gün sonunda bu cihaza kaydedilir. Başka bir cihaza taşımak için kaydı dosya ya da kod olarak dışa aktar, öbür cihazda içe aktar.</p>
      <div class="row"><button id="setExport" class="primary">Dosyaya kaydet</button><button id="setCopy">Kodu kopyala</button></div>
      <div class="row"><button id="setImport">İçe aktar</button></div>
      <h4>Tehlikeli bölge</h4>
      <div class="row"><button id="setMenu">Ana menüye dön</button><button id="setReset" class="danger">${S && S.daily ? 'Günün görevini bırak' : 'Oyunu sıfırla'}</button></div>
      <p class="meta" style="margin-top:14px">Harita: © OpenStreetMap katkıcıları, OpenFreeMap, OpenMapTiles. Harita motoru: MapLibre GL JS.</p>`;
    body.querySelectorAll('input[data-k]').forEach(i => i.onchange = () => {
      settings[i.dataset.k] = i.checked; saveSettings(); applyVolume();
      if (i.dataset.k === 'sfx' && i.checked) play('coin');
      if (i.dataset.k === 'haptics' && i.checked) fx('buy');
      if (i.dataset.k === 'tips' && !i.checked) hideTip();
      if (i.dataset.k === 'cb') applyCb();
    });
    const vol = body.querySelector('#setVol');
    vol.oninput = () => { settings.volume = vol.value / 100; body.querySelector('#volLbl').textContent = pct(settings.volume); applyVolume(); };
    vol.onchange = () => { saveSettings(); play('coin'); };
    body.querySelectorAll('#setSpeed button').forEach(b => b.onclick = () => { settings.speed = Number(b.dataset.v); saveSettings(); setSpeed(settings.speed); refreshSheet(); });
    body.querySelector('#setGuide').onclick = openGuide;
    body.querySelector('#setTipsReset').onclick = () => { settings.tipsSeen = []; settings.tips = true; saveSettings(); toast('İpuçları yeniden gösterilecek.'); refreshSheet(); };
    body.querySelector('#setExport').onclick = async () => {
      save();
      const code = await encodeSave(S);
      const safe = S.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'kayit';
      downloadText(`skyweave-${safe}-gun${S.day}.skyweave.txt`, code, 'text/plain');
      toast('Kayıt dosyası indirildi.');
    };
    body.querySelector('#setCopy').onclick = async () => {
      save();
      const code = await encodeSave(S);
      try { await navigator.clipboard.writeText(code); toast(`Kayıt kodu kopyalandı (${Math.ceil(code.length / 1024)} KB).`); }
      catch (_) { openImport(code); }
    };
    body.querySelector('#setImport').onclick = () => openImport();
    if (S) bindBrand(body);
    if (focus === 'brand') body.querySelector('#brandSec')?.scrollIntoView();
    body.querySelector('#setMenu').onclick = toMenu;
    body.querySelector('#setReset').onclick = () => {
      if (S && S.daily) {
        if (!confirm('Günün görevi bırakılsın mı? Bugün yeniden baştan başlayabilirsin.')) return;
        try { localStorage.removeItem(DAILY_KEY); } catch (_) { /* yok */ }
        S = null; closeSheet(); syncGlobe(); updateMarkers(); setupStart(); $('start').classList.add('show');
        return;
      }
      if (!confirm('Oyun tamamen silinsin mi? Holding yıldızların dahil her şey kaybolur. Bu geri alınamaz.')) return;
      try { localStorage.removeItem(SAVE_KEY); } catch (_) { /* yok */ }
      S = null; closeSheet(); syncGlobe(); updateMarkers(); setupStart(); $('start').classList.add('show');
    };
  });
}
$('btnSettings').onclick = () => { if (S && !S.over) { if (panel && panel.name === 'settings') closeSheet(); else openSettings(); } };

function openGuide() {
  openSheet('guide', body => {
    body.innerHTML = `<h3>Nasıl oynanır</h3><div class="meta">Bir başlığa dokunarak aç.</div>
      <div class="list">${GUIDE.map(([t, x], i) => `<details class="item guide" ${i < 2 ? 'open' : ''}><summary class="t">${t}</summary><div class="s">${x}</div></details>`).join('')}</div>
      <div class="row"><button id="gBack" class="ghost">Ayarlara dön</button></div>`;
    body.querySelector('#gBack').onclick = openSettings;
  });
}

// Kayıt içe aktarma kartı (açılış ekranından da açılır). code verilirse kopyalanacak kodu gösterir.
function openImport(code) {
  const o = $('importBox'), ta = $('impText');
  $('impTitle').textContent = code ? 'Kayıt kodun' : 'Kaydı içe aktar';
  $('impNote').textContent = code ? 'Panoya erişilemedi. Kodu seçip kopyala, öbür cihazda İçe aktar ekranına yapıştır.' : 'Kayıt dosyasını seç ya da kayıt kodunu aşağıya yapıştır. Bu cihazdaki mevcut oyunun yerini alır.';
  ta.value = code || ''; ta.readOnly = !!code;
  $('impFileRow').style.display = code ? 'none' : '';
  $('impGo').style.display = code ? 'none' : '';
  $('impErr').textContent = '';
  o.classList.add('show');
  if (code) setTimeout(() => ta.select(), 50);
}
$('impCancel').onclick = () => $('importBox').classList.remove('show');
$('impFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  $('impText').value = await f.text(); e.target.value = '';
  $('impGo').click();
};
$('impGo').onclick = async () => {
  try {
    const st = sanitizeImported(await decodeSave($('impText').value));
    if (st.over) throw new Error('Bu kayıt iflas etmiş bir oyuna ait.');
    if (S && !confirm(`"${st.name}" (gün ${st.day}) yüklensin mi? Şu anki oyunun yerini alacak.`)) return;
    $('importBox').classList.remove('show');
    st.lastSeen = Date.now(); // başka cihazda geçen süre çevrimdışı kazanç sayılmaz
    startGame(st); save();
    fx('goal'); toast(`Kayıt yüklendi: ${st.name} · gün ${st.day}`);
  } catch (err) { $('impErr').textContent = err.message || 'Kayıt okunamadı.'; fx('error'); }
};
$('btnImportStart').onclick = () => openImport();

// Dışarıdan gelen kayıt güvenilmez: arayüzde HTML olarak basılan alanları temizle ve doğrula.
function sanitizeImported(st) {
  const bad = msg => { throw new Error('Kayıt bozuk ya da değiştirilmiş: ' + msg); };
  // 1) Tüm metinlerden HTML karakterlerini ayıkla
  const clean = v => {
    if (typeof v === 'string') return v.replace(/[<>"`]/g, '');
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; o[k] = clean(v[k]); } return o; }
    return typeof v === 'number' && !isFinite(v) ? 0 : v;
  };
  st = clean(st);
  const COLOR = /^#[0-9a-f]{3,8}$/i, ID = /^[A-Za-z0-9_-]{1,40}$/;
  const color = c => COLOR.test(c || '') ? c : '#8ea3bd';
  const isAp = c => typeof c === 'string' && Object.prototype.hasOwnProperty.call(AP, c);
  const numF = (o, ...ks) => ks.forEach(k => { if (o[k] != null) o[k] = Number(o[k]) || 0; });
  // 2) Yapıyı doğrula
  st.name = String(st.name || 'Havayolu').slice(0, 24);
  numF(st, 'cash', 't', 'day', 'tier', 'totalPax', 'seq', 'regSeq', 'float', 'service', 'newsSeen');
  st.tier = Math.max(1, Math.min(4, Math.round(st.tier) || 1));
  if (!st.bases.length || !st.bases.every(isAp)) bad('üs');
  if (st.firstBase && !isAp(st.firstBase)) st.firstBase = st.bases[0];
  for (const f of st.fleet) {
    if (!ID.test(f.id) || !Object.prototype.hasOwnProperty.call(AC, f.type)) bad('uçak');
    f.reg = String(f.reg || '').replace(/[^A-Z0-9-]/gi, '').slice(0, 10);
    if (f.route != null && !ID.test(f.route)) f.route = null;
    numF(f, 'age', 'cond', 'leaseDay');
  }
  for (const r of st.routes) {
    if (!ID.test(r.id) || !isAp(r.a) || !isAp(r.b)) bad('rota');
    r.color = color(r.color);
    r.planes = (r.planes || []).filter(id => ID.test(id) && st.fleet.some(f => f.id === id));
    numF(r, 'fareMul', 'age', 'cabin');
    if (r.last) for (const k of Object.keys(r.last)) r.last[k] = Number(r.last[k]) || 0;
    if (r.hist) r.hist = r.hist.map(h => ({ d: Number(h.d) || 0, net: Number(h.net) || 0, load: Number(h.load) || 0, share: h.share == null ? null : Number(h.share) || 0, pax: Number(h.pax) || 0 }));
  }
  st.history = (st.history || []).map(h => { const o = {}; for (const k of Object.keys(h)) o[k] = Number(h[k]) || 0; return o; });
  for (const rv of st.rivals || []) {
    rv.color = color(rv.color);
    if (!isAp(rv.hub)) bad('rakip');
    rv.routes = (rv.routes || []).filter(rr => isAp(rr.a) && isAp(rr.b) && Object.prototype.hasOwnProperty.call(AC, rr.type));
  }
  // v1.0: sözleşmeler, rozetler
  const okDeal = c => ['seats', 'cargo', 'pax'].includes(c.kind) && ID.test(c.id || '') && (c.kind === 'pax' ? isAp(c.ap) : isAp(c.a) && isAp(c.b));
  st.offers = (st.offers || []).filter(okDeal);
  st.contracts = (st.contracts || []).filter(okDeal);
  for (const c of [...st.offers, ...st.contracts]) numF(c, 'need', 'days', 'reward', 'penalty', 'extra', 'rep', 'expires', 'start', 'end', 'prog', 'strikes');
  st.contractLog = (st.contractLog || []).map(l => ({ kind: String(l.kind), title: String(l.title || '').slice(0, 80), ok: !!l.ok, day: Number(l.day) || 0, reward: Number(l.reward) || 0 }));
  const known = new Set(X.BADGES.map(b => b.id)), bd = {};
  for (const [k, v] of Object.entries(st.badges || {})) if (known.has(k)) bd[k] = Number(v) || 0;
  st.badges = bd;
  st.acquired = (st.acquired || []).filter(x => ID.test(x));
  numF(st, 'totalCargo', 'contractsDone', 'loansRepaid');
  delete st.daily; delete st.rngState;
  if (st.legacy && st.legacy.path && !sim.PATHS[st.legacy.path]) st.legacy.path = 'none';
  if (st.brand) st.brand = ID.brandOf(st);
  if (st.scenario) {
    if (!SC.SCENARIOS.some(x => x.id === st.scenario.id && x.days)) delete st.scenario;
    else st.scenario = { id: st.scenario.id, days: Number(st.scenario.days) || 0, won: st.scenario.won == null ? null : Number(st.scenario.won) || 0, lost: !!st.scenario.lost, stars: Math.max(0, Math.min(3, Number(st.scenario.stars) || 0)) };
  }
  for (const n of st.news || []) n.color = color(n.color);
  for (const e of st.events || []) if (e.airports) e.airports = e.airports.filter(isAp);
  st.bases = st.bases.filter(isAp);
  return st;
}

// ---------- Bağlamsal ipuçları ----------
let tipShown = null, tipAcc = 0;
function hideTip() { $('coach').classList.remove('show'); }
function checkTips() {
  if (!S || S.over || !settings.tips || tipShown || pickFrom || panel || document.querySelector('.overlay.show')) return;
  if ($('hint').classList.contains('show')) return; // önce ana adımlar
  const t = nextTip(S, settings.tipsSeen);
  if (!t) return;
  tipShown = t;
  const c = $('coach');
  c.querySelector('.ct').textContent = t.title;
  c.querySelector('.cx').innerHTML = t.text;
  const go = c.querySelector('.cgo');
  go.style.display = t.open ? '' : 'none';
  go.textContent = t.btn || 'Göster';
  c.querySelector('.cstep').textContent = `İpucu ${settings.tipsSeen.length + 1}/${TIPS.length}`;
  c.classList.add('show');
  play('notify');
}
function dismissTip(open) {
  if (!tipShown) return;
  const t = tipShown;
  settings.tipsSeen.push(t.id); saveSettings();
  tipShown = null; hideTip();
  if (open && t.open) {
    const [p, tab] = t.open;
    ({ routes: openRoutes, fleet: openFleet, license: () => openGrowth(tab), report: () => openReport(tab), rivals: openRivals, news: openNews, settings: () => openSettings('brand') })[p]();
  }
}
$('coach').querySelector('.cok').onclick = () => dismissTip(false);
$('coach').querySelector('.cgo').onclick = () => dismissTip(true);
$('coach').querySelector('.coff').onclick = () => { settings.tips = false; saveSettings(); dismissTip(false); toast('İpuçları kapatıldı. Ayarlar\'dan açabilirsin.'); };

// Düğmelere hafif tık sesi
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b && !b.disabled) play('click');
}, true);

// ---------- Uygulama olarak kurulum (PWA) ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !location.search.includes('nosw')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* desteklenmiyor */ }));
}

setupStart();
requestAnimationFrame(frame);

// Test için: ?debug ile açınca konsoldan erişilebilir.
if (location.search.includes('debug')) window.SKY = { get S() { return S; }, sim, globe, endOfDay, openPlanner, createRoute, acquire, AP, AC, zoomToAirport, traffic, openRivals, spawnRivals, weeklyRivals, openNews, showDecision, dailyEvents, P, openGrowth, showOffline, addRoute, D, openAirport, openRoute, openFleet, openMarket, openReport, openSettings, checkTips, X, G, endOfDayN: n => { for (let i = 0; i < n; i++) endOfDay(); } };
