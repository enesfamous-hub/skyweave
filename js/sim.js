// Talep ve ekonomi hesapları. Arayüzden bağımsızdır (Node ile de test edilebilir).
import { AIRPORTS, AIRCRAFT, TIERS } from './data.js';

export const AP = Object.fromEntries(AIRPORTS.map(a => [a.c, a]));
export const AC = Object.fromEntries(AIRCRAFT.map(a => [a.id, a]));

export const START = Date.UTC(2027, 3, 1, 6, 0, 0); // 1 Nisan 2027, 09:00 TSİ
export const FUEL_PRICE = 0.8;      // $/kg
export const PAX_FEE = 6;           // yolcu başına havalimanı ücreti $
export const LEASE_RATE = 0.00013;  // günlük kira = fiyat × oran + 2500 $
export const OWN_RATE = 0.00006;    // sahip olunan uçak günlük bakım/sigorta
export const BASE_COST = 1.5e6;     // yeni üs
export const MIN_ROUTE_KM = 150;
export const RAMP_DAYS = 30;        // yeni rotanın tam talebe ulaşma süresi
export const BANKRUPT = -10e6;

const R = 6371;
const rad = d => d * Math.PI / 180;

export function distKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const gameDate = t => new Date(START + t * 3600e3);
export function dayOfYear(date) {
  return Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 1)) / 864e5) + 1;
}

// Sezon: yazın talep artar, turistik yerlerde çok daha fazla.
export function seasonFactor(ap, doy) {
  const hemi = ap.lat < 0 ? -1 : 1;
  const summer = Math.cos(2 * Math.PI * (doy - 196) / 365) * hemi; // +1 Temmuz ortası
  return 1 + 0.08 * summer + ap.t * 0.6 * Math.max(0, summer) - ap.t * 0.3 * Math.max(0, -summer);
}

export const baseFare = d => Math.round(35 + 0.075 * d);

// Yön başına günlük talep (yolcu).
export function demandPerDir(a, b, doy, fareMul = 1) {
  const d = distKm(a, b);
  const distEffect = Math.min(1, d / 400) * Math.pow(2000 / (d + 1500), 0.6);
  const intl = a.co === b.co ? 1 : (a.z === 'W' || b.z === 'W') ? 0.5 : 0.6;
  const season = (seasonFactor(a, doy) + seasonFactor(b, doy)) / 2;
  return 300 * Math.sqrt(a.p * b.p) * distEffect * intl * season * Math.pow(1 / fareMul, 1.4);
}

export const blockHours = (d, ac) => d / ac.speed + 0.4;
export const rtHours = (d, ac) => 2 * blockHours(d, ac) + 2 * ac.turn;
export const rtPerDay = (d, ac) => ac.util / rtHours(d, ac);
export const legCost = (d, ac, fuelMul = 1, wageMul = 1) => ac.burn * d * FUEL_PRICE * fuelMul + ac.hourly * wageMul * blockHours(d, ac) + ac.fee;

// ---------- Olay etkileri ----------
const evActive = (S, e) => S.day >= (e.from ?? 0) && S.day < e.until;
const evHits = (e, ap) => e.global || (e.airports && e.airports.includes(ap.c)) || (e.country && ap.co === e.country) || (e.tourist && ap.t >= 0.5);
export function activeEvents(S) { return S && S.events ? S.events.filter(e => evActive(S, e)) : []; }
// Bir havalimanı için talep ve kapasite çarpanları
export function evFactors(S, code) {
  let dem = 1, cap = 1;
  const ap = AP[code];
  for (const e of activeEvents(S)) if (evHits(e, ap)) { dem *= e.dem ?? 1; cap = Math.min(cap, e.cap ?? 1); }
  return { dem, cap };
}
export function fuelMul(S, player = false) {
  if (player && S && S.hedgeUntil > S.day) return 1;
  return activeEvents(S).reduce((m, e) => m * (e.fuel ?? 1), 1);
}
export const grounded = S => new Set(activeEvents(S).filter(e => e.grounded).map(e => e.grounded));
// ---------- Yükseltme ve prestij etkileri ----------
export const lvl = (S, id) => (S && S.upgrades && S.upgrades[id]) || 0;
export const stars = S => (S && S.legacy && S.legacy.stars) || 0;
// Yükseltmelerle değişmiş uçak (yer süresi kısalır)
const effAc = (S, ac) => lvl(S, 'turn') ? { ...ac, turn: ac.turn * (1 - 0.08 * lvl(S, 'turn')) } : ac;
// Yeni hat talep artışı (açılış kampanyaları ile hızlanır)
export function rampP(S, age) {
  const L = lvl(S, 'launch'), start = 0.4 + 0.1 * L, days = RAMP_DAYS * (1 - 0.15 * L);
  return Math.min(1, start + (1 - start) * (age || 0) / days);
}
export const playerFixed = (S, f) => fixedPerDay(f) * (1 - 0.06 * lvl(S, 'maint'));
export const playerRep = S => (S ? (S.rep || 1) : 1) * (1 + 0.03 * lvl(S, 'lounge')) * activeEvents(S).reduce((m, e) => m * (e.rep ?? 1), 1);
export const playerStrike = S => activeEvents(S).some(e => e.strike);
// Bir hattın kapasite çarpanı (iki ucun en kötüsü)
export const pairCap = (S, aC, bC) => S ? Math.min(evFactors(S, aC).cap, evFactors(S, bC).cap) : 1;
export const leasePerDay = ac => ac.price * 1e6 * LEASE_RATE + 2500;
export const ownPerDay = ac => ac.price * 1e6 * OWN_RATE;
export const fixedPerDay = f => f.leased ? leasePerDay(AC[f.type]) : ownPerDay(AC[f.type]);

// ---------- Pazar ve rekabet ----------
export const pairKey = (a, b) => a < b ? a + '-' + b : b + '-' + a;
export const rampOf = age => Math.min(1, 0.4 + 0.6 * (age || 0) / RAMP_DAYS);

// Rakip rotasının yön başına günlük koltuğu
export function rivalRouteSeats(rr, S = null) {
  const d = distKm(AP[rr.a], AP[rr.b]), ac = AC[rr.type];
  if (S && grounded(S).has(rr.type)) return 0;
  return rr.n * ac.seats * rtPerDay(d, ac) * pairCap(S, rr.a, rr.b);
}

export function rivalsOnPair(S, aC, bC) {
  const k = pairKey(aC, bC), out = [];
  if (!S || !S.rivals) return out;
  for (const rv of S.rivals) if (rv.active) for (const rr of rv.routes) if (pairKey(rr.a, rr.b) === k) out.push({ rv, rr });
  return out;
}

// Talebi havayolları arasında paylaştır. Pay: kapasite, fiyat ve itibara göre.
// Dolu olanın taşan yolcusunun bir kısmı boş koltuğu olana geçer.
export function allocate(D0, carriers) {
  if (!carriers.length) return [];
  const w = carriers.map(c => Math.sqrt(Math.max(1, c.seats)) * Math.pow(c.fareMul, -2.2) * (c.rep || 1));
  const W = w.reduce((s, x) => s + x, 0) || 1;
  const boost = 1 + 0.15 * Math.min(1, (carriers.length - 1) / 2); // rekabet pazarı biraz büyütür
  const pot = carriers.map((c, i) => D0 * (w[i] / W) * Math.pow(c.fareMul, -1.4) * (c.ramp ?? 1) * boost);
  const pax = carriers.map((c, i) => Math.min(c.seats, pot[i]));
  let spill = carriers.reduce((s, c, i) => s + Math.max(0, pot[i] - c.seats), 0) * 0.6;
  for (let it = 0; it < 2 && spill > 1; it++) {
    const free = carriers.map((c, i) => Math.max(0, c.seats - pax[i]));
    const F = free.reduce((s, x) => s + x, 0);
    if (F < 1) break;
    const give = Math.min(spill, F);
    free.forEach((f, i) => { pax[i] += give * f / F; });
    spill -= give;
  }
  return pax;
}

// Oyuncunun uçabilen günlük gidiş-dönüş sayısı (hava, grev, teknik inceleme düşülür)
function playerRt(S, route, f, d) {
  if (S && (playerStrike(S) || grounded(S).has(f.type))) return 0;
  return rtPerDay(d, effAc(S, AC[f.type])) * pairCap(S, route.a, route.b);
}
function playerSeats(S, route, fleet, d) {
  let seats = 0;
  for (const id of route.planes) { const f = fleet.find(x => x.id === id); if (f) seats += AC[f.type].seats * playerRt(S, route, f, d); }
  return seats;
}

// Bir hattaki tüm havayolları ve paylaştırılmış yolcuları.
export function pairMarket(S, aC, bC, doy, { playerRoute = null, fleet = S ? S.fleet : [], mature = false } = {}) {
  const a = AP[aC], b = AP[bC], d = distKm(a, b);
  const D0 = demandPerDir(a, b, doy, 1) * (S ? evFactors(S, aC).dem * evFactors(S, bC).dem : 1);
  const entries = [];
  const pr = playerRoute || (S ? S.routes.find(r => pairKey(r.a, r.b) === pairKey(aC, bC)) : null);
  if (pr) entries.push({ kind: 'player', route: pr, seats: playerSeats(S, pr, fleet, d), fareMul: pr.fareMul, rep: playerRep(S), ramp: (mature ? 1 : rampP(S, pr.age)) * (1 + 0.03 * lvl(S, 'mkt')) });
  for (const { rv, rr } of rivalsOnPair(S, aC, bC)) {
    entries.push({ kind: 'rival', rv, route: rr, seats: rivalRouteSeats(rr, S), fareMul: rr.fareMul, rep: rv.rep, ramp: rampOf(rr.age) });
  }
  const pax = allocate(D0, entries);
  entries.forEach((e, i) => { e.pax = pax[i]; e.fare = baseFare(d) * e.fareMul; });
  return { d, D0, entries, total: pax.reduce((s, x) => s + x, 0) };
}

// Oyuncunun bir rotasının günlük ekonomisi (rakipler dahil). mature=true: talep artışı tamamlanmış say.
export function routeEcon(route, fleet, doy, mature = false, S = null) {
  const m = pairMarket(S, route.a, route.b, doy, { playerRoute: route, fleet, mature });
  const me = m.entries[0], d = m.d;
  let legs = 0, opCost = 0, fixed = 0;
  for (const id of route.planes) {
    const p = fleet.find(f => f.id === id); if (!p) continue;
    const ac = AC[p.type], rt = playerRt(S, route, p, d);
    const fm = fuelMul(S, true) * (1 - 0.04 * lvl(S, 'fuel'));
    const wm = (S ? S.wageMul || 1 : 1) * (1 - 0.04 * lvl(S, 'crew'));
    legs += 2 * rt; opCost += 2 * rt * legCost(d, ac, fm, wm); fixed += playerFixed(S, p);
  }
  const fare = baseFare(d) * route.fareMul;
  const pax = me.pax, seats = me.seats;
  const revenue = 2 * pax * fare * (1 + 0.05 * stars(S));
  const cost = opCost + 2 * pax * PAX_FEE;
  return {
    d, seats, pax, legs, fare, revenue, cost, fixed,
    demand: m.D0 * Math.pow(route.fareMul, -1.4) * me.ramp,   // pazarın toplam talebi (bizim fiyatla)
    share: m.total ? pax / m.total : 1,
    comps: m.entries.slice(1),
    load: seats ? pax / seats : 0,
    profit: revenue - cost,            // uçak kirası hariç
    net: revenue - cost - fixed,       // uçak kirası dahil
  };
}

// Rakibin bir rotasının günlük ekonomisi
export function rivalRouteEcon(S, rv, rr, doy) {
  const m = pairMarket(S, rr.a, rr.b, doy);
  const e = m.entries.find(x => x.route === rr);
  const ac = AC[rr.type];
  const rt = grounded(S).has(rr.type) ? 0 : rtPerDay(m.d, ac) * pairCap(S, rr.a, rr.b);
  const revenue = 2 * e.pax * e.fare;
  const cost = rr.n * (2 * rt * legCost(m.d, ac, fuelMul(S)) + leasePerDay(ac)) + 2 * e.pax * PAX_FEE;
  return { pax: e.pax, seats: e.seats, load: e.seats ? e.pax / e.seats : 0, revenue, cost, profit: revenue - cost, share: m.total ? e.pax / m.total : 1 };
}

export const managerSalaries = S => Object.values(S.managers || {}).reduce((s, m) => s + (m.on ? m.salary : 0), 0);
export const overheadPerDay = S => (3000 + 1500 * S.bases.length + 300 * S.fleet.length) * (S.overheadMul || 1) + managerSalaries(S);

// Gün sonu hesabı. State'i günceller, özet döner.
export function settleDay(S) {
  const doy = dayOfYear(gameDate(S.t));
  let revenue = 0, cost = 0, pax = 0;
  for (const r of S.routes) {
    const e = routeEcon(r, S.fleet, doy, false, S);
    r.last = { pax: Math.round(2 * e.pax), load: e.load, revenue: e.revenue, net: e.net, demand: Math.round(e.demand), share: e.share };
    revenue += e.revenue; cost += e.cost; pax += 2 * e.pax;
  }
  // Rakipler (aynı pazar paylaşımıyla)
  for (const rv of S.rivals || []) {
    if (!rv.active) continue;
    let rp = 0, rpax = 0;
    for (const rr of rv.routes) {
      const e = rivalRouteEcon(S, rv, rr, doy);
      rr.last = { pax: Math.round(2 * e.pax), load: e.load, profit: e.profit, share: e.share };
      rp += e.profit; rpax += 2 * e.pax;
    }
    const fleetN = rv.routes.reduce((s, r) => s + r.n, 0);
    rp -= 2500 + 300 * fleetN;
    rv.cash += rp;
    rv.lastProfit = rp; rv.lastPax = Math.round(rpax);
    rv.routes.forEach(rr => { rr.age = (rr.age || 0) + 1; });
  }
  S.routes.forEach(r => { r.age = (r.age || 0) + 1; });
  const fleetCost = S.fleet.reduce((s, f) => s + playerFixed(S, f), 0);
  const overhead = overheadPerDay(S);
  const interest = S.cash < 0 ? -S.cash * 0.0005 : 0;
  cost += fleetCost + overhead + interest;
  pax = Math.round(pax);
  S.cash += revenue - cost;
  S.totalPax += pax;
  S.day++;
  const rec = { day: S.day, revenue, cost, profit: revenue - cost, pax };
  S.history.push(rec);
  if (S.history.length > 60) S.history.shift();
  return rec;
}

export const tierOf = S => TIERS[S.tier - 1];
export const tierForZone = z => TIERS.find(t => t.zones.includes(z));

// Bu rota açılabilir mi? Açılamazsa sebebini döner.
export function routeBlocker(S, a, b) {
  const tier = tierOf(S);
  if (a === b) return 'Aynı havaalanı';
  if (!S.bases.includes(a.c) && !S.bases.includes(b.c)) return 'Rotanın bir ucu üssün olmalı';
  for (const ap of [a, b]) if (!tier.zones.includes(ap.z)) return `${ap.n} için ${tierForZone(ap.z).name} lisansı gerekir`;
  const d = distKm(a, b);
  if (d < MIN_ROUTE_KM) return `Çok yakın (${Math.round(d)} km), yolcular karayolunu seçer`;
  if (d > tier.maxKm) return `${tier.name} lisansı en fazla ${tier.maxKm} km'ye izin verir (${Math.round(d)} km)`;
  if (S.routes.some(r => (r.a === a.c && r.b === b.c) || (r.a === b.c && r.b === a.c))) return 'Bu rota zaten var';
  return null;
}
