// Talep ve ekonomi hesapları. Arayüzden bağımsızdır (Node ile de test edilebilir).
import { AIRPORTS, AIRCRAFT, TIERS } from './data.js';

export const AP = Object.fromEntries(AIRPORTS.map(a => [a.c, a]));
export const AC = Object.fromEntries(AIRCRAFT.map(a => [a.id, a]));

export const START = Date.UTC(2027, 3, 1, 6, 0, 0); // 1 Nisan 2027, 09:00 TSİ
export const FUEL_PRICE = 0.8;      // $/kg
export const PAX_FEE = 6;           // yolcu başına havalimanı ücreti $
export const LEASE_RATE = 0.00013;  // günlük kira = fiyat × oran + 2500 $
export const OWN_RATE = 0.00006;    // sahip olunan uçak günlük bakım/sigorta
export const BASE_COST = 1.5e6;     // ikinci üs; sonrakiler pahalılaşır
export const baseCost = S => Math.round(BASE_COST * Math.pow(1.8, Math.max(0, S.bases.length - 1)) / 1e5) * 1e5;
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

// Uzun hatlarda km başı ücret azalır (2.000 km'den sonra 0,05 $/km)
export const baseFare = d => Math.round(35 + 0.075 * Math.min(d, 2000) + 0.05 * Math.max(0, d - 2000));

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
// ---------- Holding yolu (prestij sonrası seçilen strateji) ----------
export const PATHS = {
  none:  { id: 'none',  name: 'Klasik havayolu', icon: '✈', desc: 'Dengeli: özel bonus yok.', cost: 1, dem: 1, biz: 1, rep: 1, cargo: 1, cRate: 1, paxFee: 0 },
  lcc:   { id: 'lcc',   name: 'Ucuz havayolu',   icon: '🎫', desc: 'İşletme gideri −%4, yolcu başı gider −1 $, talep +%3. Business talebi −%40, itibar −%5.', cost: 0.96, dem: 1.03, biz: 0.6, rep: 0.95, cargo: 1, cRate: 1, paxFee: -1 },
  lux:   { id: 'lux',   name: 'Lüks havayolu',   icon: '🥂', desc: 'Business talebi +%60, itibar +%12 (rakiplere karşı pazar payı). İşletme gideri +%2.', cost: 1.02, dem: 1, biz: 1.6, rep: 1.12, cargo: 1, cRate: 1, paxFee: 0 },
  cargo: { id: 'cargo', name: 'Kargo devi',      icon: '📦', desc: 'Kargo talebi +%80, kargo ücreti +%20. Kargo anlaşmaları daha sık gelir.', cost: 1, dem: 1, biz: 1, rep: 1, cargo: 1.8, cRate: 1.2, paxFee: 0 },
};
export const pathOf = S => PATHS[S && S.legacy && S.legacy.path] || PATHS.none;

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
export const playerRep = S => (S ? (S.rep || 1) : 1) * pathOf(S).rep * (1 + 0.03 * lvl(S, 'lounge')) * activeEvents(S).reduce((m, e) => m * (e.rep ?? 1), 1) * serviceOf(S).rep * fleetQuality(S);
export const playerStrike = S => activeEvents(S).some(e => e.strike);
// Bir hattın kapasite çarpanı (iki ucun en kötüsü)
export const pairCap = (S, aC, bC) => S ? Math.min(evFactors(S, aC).cap, evFactors(S, bC).cap) : 1;
export const leasePerDay = ac => ac.price * 1e6 * LEASE_RATE + 2500;
export const ownPerDay = ac => ac.price * 1e6 * OWN_RATE;
export const fixedPerDay = f => f.leased ? (f.leaseDay || leasePerDay(AC[f.type])) : ownPerDay(AC[f.type]) * (1 + 0.04 * ageYears(f));

// ---------- Uçak yaşı, durum ve bakım ----------
export const ageYears = f => (f.age || 0) / 365;
export const condOf = f => f.cond ?? 100;
export const isDown = (S, f) => !!(f.down && S && f.down.until > S.day);
// Uçağın piyasa değeri: yaşla düşer, durum kötüyse daha da düşer
export const planeValue = f => AC[f.type].price * 1e6 * 0.75 * Math.pow(0.94, ageYears(f)) * (0.75 + 0.25 * condOf(f) / 100);
export const checkCost = f => Math.round(AC[f.type].price * 1e6 * 0.01 * (1 + 0.05 * ageYears(f)) / 1000) * 1000;
export const CHECK_DAYS = 4;
export const checkRestores = f => Math.max(70, 100 - 1.2 * ageYears(f));
// Yaşlı ve yıpranmış uçak daha çok yakıt yakar
export const planeFuelMul = f => (1 + 0.006 * ageYears(f)) * (condOf(f) < 60 ? 1.03 : 1);
// Filonun ortalama yaşı ve durumu itibarı etkiler
export function fleetQuality(S) {
  if (!S || !S.fleet || !S.fleet.length) return 1;
  let age = 0, cond = 0;
  for (const f of S.fleet) { age += ageYears(f); cond += condOf(f); }
  age /= S.fleet.length; cond /= S.fleet.length;
  return Math.max(0.82, 1 - 0.012 * Math.max(0, age - 8) - 0.004 * Math.max(0, 70 - cond));
}

// ---------- Kabin sınıfları ve hizmet ----------
export const CABINS = [
  { id: 0, name: 'Tek sınıf', frac: 0,    desc: 'Tüm koltuklar ekonomi' },
  { id: 1, name: 'Karma',     frac: 0.15, desc: "Kabinin %15'i business" },
  { id: 2, name: 'Premium',   frac: 0.30, desc: "Kabinin %30'u business" },
];
export const BIZ_SPACE = 2.5;   // bir business koltuğu 2,5 ekonomi koltuğu yer kaplar
export const BIZ_FARE = 3.2;    // business bileti ekonominin 3,2 katı
export const SERVICE = [
  { name: 'Ekonomik', cost: -3, rep: 0.92, biz: 0.6,  desc: 'İkram yok, dar koltuk aralığı' },
  { name: 'Standart', cost: 0,  rep: 1,    biz: 1,    desc: 'Sıcak içecek ve atıştırmalık' },
  { name: 'Konforlu', cost: 6,  rep: 1.07, biz: 1.25, desc: 'Sıcak yemek, geniş koltuk aralığı' },
  { name: 'Premium',  cost: 14, rep: 1.13, biz: 1.5,  desc: 'Şef menüsü, uçak içi eğlence, Wi-Fi' },
];
export const serviceOf = S => SERVICE[S && S.service != null ? S.service : 1];
// Bir hattaki yolcuların business seçme eğilimi
export const bizShare = (a, b, d) => 0.05 + (a.co !== b.co ? 0.04 : 0) + 0.06 * Math.min(1, d / 4000) + 0.004 * Math.min(15, Math.sqrt(a.p * b.p));

// ---------- Havalimanı slotları ----------
// Büyük havalimanlarında günlük kalkış hakkı sınırlıdır. Paket satın alarak artırılır.
export const SLOT_PACK = 5;
export const BASE_SLOTS = 40, FREE_SLOTS = 10;
export const slotControlled = ap => ap.p >= 3 || (ap.t >= 1 && ap.p >= 2);
export const slotPacks = (S, code) => (S && S.slots && S.slots[code]) || 0;
export function slotCap(S, code) {
  const ap = AP[code];
  if (!slotControlled(ap)) return Infinity;
  return (S.bases.includes(code) ? BASE_SLOTS : FREE_SLOTS) + SLOT_PACK * slotPacks(S, code);
}
export function slotPackPrice(S, code) {
  const ap = AP[code], zm = ap.z === 'TR' ? 1 : ap.z === 'K' ? 1.6 : 2.2;
  return Math.round(25e3 * ap.p * zm * Math.pow(1.25, slotPacks(S, code)) / 1000) * 1000;
}
// Havalimanı başına günlük kalkış kullanımı (bakımdaki uçaklar sayılmaz). Önbellekli.
let slotMemo = { key: null, map: null, S: null };
export function slotUse(S) {
  const key = S.day + '|' + lvl(S, 'turn') + '|' + S.bases.join() + '|' + JSON.stringify(S.slots || {}) + '|'
    + S.routes.map(r => r.a + r.b + r.planes.join('.')).join(',') + '|' + S.fleet.map(f => f.down ? f.down.until : 0).join('');
  if (slotMemo.key === key && slotMemo.S === S) return slotMemo.map;
  const map = {};
  for (const r of S.routes) {
    const d = distKm(AP[r.a], AP[r.b]);
    let deps = 0;
    for (const id of r.planes) { const f = S.fleet.find(x => x.id === id); if (f && !isDown(S, f)) deps += rtPerDay(d, effAc(S, AC[f.type])); }
    for (const c of [r.a, r.b]) map[c] = (map[c] || 0) + deps;
  }
  slotMemo = { key, map, S };
  return map;
}
export const slotUsed = (S, code) => slotUse(S)[code] || 0;
export const slotFree = (S, code) => slotCap(S, code) - slotUsed(S, code);
export function slotFactor(S, code) {
  if (!S) return 1;
  const cap = slotCap(S, code); if (cap === Infinity) return 1;
  const u = slotUsed(S, code);
  return u > cap ? cap / u : 1;
}
// Bir uçağın bir hatta ihtiyaç duyduğu günlük kalkış
export const planeDeps = (S, d, type) => rtPerDay(d, effAc(S, AC[type]));

// ---------- Kargo (yolcu uçaklarının altında) ----------
// Yön başına günlük kargo talebi (ton). Uluslararası hatlarda daha yüksek.
export function cargoDemand(a, b, d) {
  const intl = a.co === b.co ? 1 : 1.3;
  return 0.8 * Math.sqrt(a.p * b.p) * Math.min(1, d / 500) * intl;
}
export const cargoRate = d => 200 + 0.35 * Math.min(d, 2000) + 0.12 * Math.max(0, d - 2000);   // $/ton
export const CARGO_HANDLING = 60;               // $/ton

// Sözleşmelerin etkisi: tanıtım kampanyası o şehrin talebini artırır, kargo anlaşması ek yük getirir
export const promoMul = (S, code) => S && S.contracts && S.contracts.some(c => c.kind === 'pax' && c.ap === code) ? 1.25 : 1;
export const contractCargo = (S, aC, bC) => S && S.contracts ? S.contracts.filter(c => c.kind === 'cargo' && pairKey(c.a, c.b) === pairKey(aC, bC)).reduce((s, c) => s + c.extra, 0) : 0;

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
  if (S && (playerStrike(S) || grounded(S).has(f.type) || isDown(S, f))) return 0;
  const slot = S && S.routes.includes(route) ? Math.min(slotFactor(S, route.a), slotFactor(S, route.b)) : 1;
  return rtPerDay(d, effAc(S, AC[f.type])) * pairCap(S, route.a, route.b) * slot;
}
function playerSeats(S, route, fleet, d) {
  let seats = 0;
  for (const id of route.planes) { const f = fleet.find(x => x.id === id); if (f) seats += AC[f.type].seats * playerRt(S, route, f, d); }
  return seats;
}
export const cabinOf = route => CABINS[route.cabin || 0];
export const ecoSeats = (route, seats) => seats * (1 - cabinOf(route).frac);
export const bizSeats = (route, seats) => seats * cabinOf(route).frac / BIZ_SPACE;

// Bir hattaki tüm havayolları ve paylaştırılmış yolcuları.
export function pairMarket(S, aC, bC, doy, { playerRoute = null, fleet = S ? S.fleet : [], mature = false } = {}) {
  const a = AP[aC], b = AP[bC], d = distKm(a, b);
  const D0 = demandPerDir(a, b, doy, 1) * (S ? evFactors(S, aC).dem * evFactors(S, bC).dem * promoMul(S, aC) * promoMul(S, bC) : 1);
  const entries = [];
  const pr = playerRoute || (S ? S.routes.find(r => pairKey(r.a, r.b) === pairKey(aC, bC)) : null);
  const phys = pr ? playerSeats(S, pr, fleet, d) : 0;
  if (pr) entries.push({ kind: 'player', route: pr, seats: ecoSeats(pr, phys), phys, fareMul: pr.fareMul, rep: playerRep(S), ramp: (mature ? 1 : rampP(S, pr.age)) * (1 + 0.03 * lvl(S, 'mkt')) * pathOf(S).dem });
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
  let legs = 0, opCost = 0, fixed = 0, cargoCap = 0;
  for (const id of route.planes) {
    const p = fleet.find(f => f.id === id); if (!p) continue;
    const ac = AC[p.type], rt = playerRt(S, route, p, d);
    cargoCap += 2 * rt * (ac.cargo || 0);
    const fm = fuelMul(S, true) * (1 - 0.04 * lvl(S, 'fuel')) * planeFuelMul(p);
    const wm = (S ? S.wageMul || 1 : 1) * (1 - 0.04 * lvl(S, 'crew'));
    legs += 2 * rt; opCost += 2 * rt * legCost(d, ac, fm, wm) * pathOf(S).cost; fixed += playerFixed(S, p);
  }
  const fare = baseFare(d) * route.fareMul;
  const pax = me.pax, seats = me.seats;
  // Business sınıfı: fiyata daha az duyarlı, hizmet kalitesine bağlı
  const svc = serviceOf(S);
  const bSeats = bizSeats(route, me.phys);
  const bFare = baseFare(d) * BIZ_FARE * route.fareMul;
  let bPax = 0;
  if (bSeats > 0) {
    const pot = m.D0 * bizShare(AP[route.a], AP[route.b], d) * svc.biz * pathOf(S).biz * (1 + 0.04 * lvl(S, 'lounge')) * me.ramp * Math.pow(route.fareMul, -0.8);
    bPax = Math.min(bSeats, pot * (m.entries.length > 1 ? 0.55 + 0.45 * (m.total ? pax / m.total : 1) : 1));
  }
  // Kargo: kapasite uçakların bölmesi, pay yolcu payı kadar
  const cShare = m.entries.length > 1 && m.total ? 0.3 + 0.7 * pax / m.total : 1;
  const cDem = cargoDemand(AP[route.a], AP[route.b], d) * (S ? evFactors(S, route.a).dem * evFactors(S, route.b).dem : 1) * (1 + 0.2 * lvl(S, 'cargo')) * pathOf(S).cargo * me.ramp;
  const cargo = Math.min(cargoCap / 2, cDem * cShare + contractCargo(S, route.a, route.b) / 2);   // yön başına ton
  const bonus = 1 + 0.05 * stars(S);
  const cargoRev = 2 * cargo * cargoRate(d) * pathOf(S).cRate * bonus;
  const revenue = 2 * (pax * fare + bPax * bFare) * bonus + cargoRev;
  const cost = opCost + 2 * (pax + bPax) * (PAX_FEE + svc.cost + pathOf(S).paxFee) + 2 * bPax * 15 + 2 * cargo * CARGO_HANDLING;
  const allSeats = seats + bSeats;
  const inS = S && S.routes.includes(route);
  return {
    d, seats, pax, legs, fare, revenue, cost, fixed,
    bSeats, bPax, bFare, phys: me.phys,
    cargo: 2 * cargo, cargoCap, cargoDem: 2 * cDem * cShare, cargoRev,
    demand: m.D0 * Math.pow(route.fareMul, -1.4) * me.ramp,   // pazarın toplam talebi (bizim fiyatla)
    share: m.total ? pax / m.total : 1,
    comps: m.entries.slice(1),
    load: allSeats ? (pax + bPax) / allSeats : 0,
    ecoLoad: seats ? pax / seats : 0,
    bizLoad: bSeats ? bPax / bSeats : 0,
    slotLimited: inS ? Math.min(slotFactor(S, route.a), slotFactor(S, route.b)) < 0.999 : false,
    profit: revenue - cost,            // uçak kirası hariç
    net: revenue - cost - fixed,       // uçak kirası dahil
  };
}

// ---------- Aktarmalı yolcu ----------
// Üslerinde (hub) iki hattın uçları arasında seyahat eden yolcular, iki hattaki boş ekonomi koltuklarını kullanır.
export const CONN_MUL = 0.45;
export function transferFlows(S, doy, free) {
  const flows = [];
  const direct = new Set(S.routes.map(r => pairKey(r.a, r.b)));
  const hubMul = 1 + 0.15 * lvl(S, 'hub');
  const rep = Math.min(1.3, playerRep(S));
  for (const h of S.bases) {
    const H = AP[h];
    const rs = S.routes.filter(r => (r.a === h || r.b === h) && (free.get(r.id) || 0) > 0.5);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const r1 = rs[i], r2 = rs[j];
      const x = r1.a === h ? r1.b : r1.a, y = r2.a === h ? r2.b : r2.a;
      if (x === y || direct.has(pairKey(x, y))) continue;
      const X = AP[x], Y = AP[y], dxy = distKm(X, Y);
      if (dxy < MIN_ROUTE_KM) continue;
      const d1 = distKm(X, H), d2 = distKm(H, Y), ratio = (d1 + d2) / dxy;
      const detour = ratio <= 1.3 ? 1 : Math.max(0, 1 - (ratio - 1.3) * 1.4);
      if (detour <= 0) continue;
      const fareMul = (r1.fareMul * d1 + r2.fareMul * d2) / (d1 + d2);
      let D = demandPerDir(X, Y, doy, 1) * evFactors(S, x).dem * evFactors(S, y).dem * CONN_MUL * detour * hubMul * rep
        * Math.pow(fareMul, -1.4) * Math.min(rampP(S, r1.age), rampP(S, r2.age)) * (1 + 0.03 * lvl(S, 'mkt'));
      if (rivalsOnPair(S, x, y).length) D *= 0.3; // rakibin direkt uçuşu varsa yolcu onu tercih eder
      if (D < 0.5) continue;
      flows.push({ h, x, y, r1, r2, d1, d2, D, fare: baseFare(dxy) * fareMul * 0.85, pax: 0 });
    }
  }
  // Boş koltuklara orantılı paylaştır
  const req = new Map();
  for (const f of flows) for (const r of [f.r1, f.r2]) req.set(r.id, (req.get(r.id) || 0) + f.D);
  const scale = id => Math.min(1, (free.get(id) || 0) / (req.get(id) || 1));
  for (const f of flows) f.pax = f.D * Math.min(scale(f.r1.id), scale(f.r2.id));
  flows.req = req;
  return flows;
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
// Genel gider: merkez, üsler ve filo. Büyük filoyu yönetmek uçak başına daha pahalıdır (organizasyon karmaşıklığı).
export const orgPerPlane = n => 300 + 40 * n;
export const overheadPerDay = S => (3000 + S.bases.reduce((s, c) => s + 1500 + 60 * AP[c].p, 0) + S.fleet.length * orgPerPlane(S.fleet.length)) * (S.overheadMul || 1) + managerSalaries(S);

// Gün sonu hesabı. State'i günceller, özet döner.
export function settleDay(S) {
  const doy = dayOfYear(gameDate(S.t));
  let revenue = 0, cost = 0, pax = 0, cargo = 0, cargoRev = 0;
  const free = new Map();
  for (const r of S.routes) {
    const e = routeEcon(r, S.fleet, doy, false, S);
    r.last = { pax: Math.round(2 * (e.pax + e.bPax)), bpax: Math.round(2 * e.bPax), tpax: 0, load: e.load, revenue: e.revenue, net: e.net, demand: Math.round(e.demand), share: e.share,
      cargo: Math.round(e.cargo * 10) / 10, cargoRev: Math.round(e.cargoRev) };
    revenue += e.revenue; cost += e.cost; pax += 2 * (e.pax + e.bPax); cargo += e.cargo; cargoRev += e.cargoRev;
    free.set(r.id, Math.max(0, e.seats - e.pax));
  }
  // Aktarmalı yolcular (iki yönde). Yolcu sayısına bir kez girer.
  const flows = transferFlows(S, doy, free);
  const bonus = 1 + 0.05 * stars(S), svc = serviceOf(S);
  let tpax = 0;
  const hubs = {};
  for (const f of flows) {
    if (f.pax < 0.5) continue;
    const rev = 2 * f.pax * f.fare * bonus, c = 2 * f.pax * (2 * (PAX_FEE + svc.cost) + 4);
    revenue += rev; cost += c; tpax += 2 * f.pax;
    hubs[f.h] = (hubs[f.h] || 0) + 2 * f.pax;
    // gelir ve yolcuyu hatlara mesafeye göre dağıt (rapor için)
    for (const [r, dd] of [[f.r1, f.d1], [f.r2, f.d2]]) {
      const w = dd / (f.d1 + f.d2);
      r.last.tpax += 2 * f.pax; r.last.revenue += rev * w; r.last.net += (rev - c) * w;
    }
  }
  S.routes.forEach(r => { r.last.tpax = Math.round(r.last.tpax); r.last.tdem = Math.round(2 * (flows.req.get(r.id) || 0)); });
  S.transfers = flows.filter(f => f.pax >= 0.5).sort((p, q) => q.pax - p.pax).slice(0, 12)
    .map(f => ({ h: f.h, x: f.x, y: f.y, pax: Math.round(2 * f.pax) }));
  S.hubPax = Object.fromEntries(Object.entries(hubs).map(([k, v]) => [k, Math.round(v)]));
  pax += tpax;
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
    rv.avgProfit = rv.avgProfit == null ? rp : rv.avgProfit * 0.95 + rp * 0.05;
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
  S.totalCargo = (S.totalCargo || 0) + cargo;
  S.day++;
  const rec = { day: S.day, revenue, cost, profit: revenue - cost, pax, tpax: Math.round(tpax), cargo: Math.round(cargo), cargoRev: Math.round(cargoRev) };
  S.history.push(rec);
  if (S.history.length > 400) S.history.shift();
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
