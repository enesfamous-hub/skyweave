// Oyunun ortasını canlı tutan sistemler: sözleşme teklifleri, rakip satın alma ve rozetler.
// (Kargo hesabı sim.js içinde, routeEcon'da.)
import { AIRPORTS, AIRCRAFT } from './data.js';
import * as sim from './sim.js';
import { companyValue } from './progress.js';
import { addRoute, nextReg } from './game.js';

const { AP, AC } = sim;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const money = n => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;
const num = n => Math.round(n).toLocaleString('tr-TR');
const round = (x, s) => Math.max(s, Math.round(x / s) * s);
const doyOf = S => sim.dayOfYear(sim.gameDate(S.t));
const pairName = (a, b) => `${AP[a].n}–${AP[b].n}`;
export const routeOn = (S, a, b) => S.routes.find(r => sim.pairKey(r.a, r.b) === sim.pairKey(a, b));
const avgProfit = S => { const h = S.history.slice(-7); return h.length ? Math.max(0, h.reduce((s, x) => s + x.profit, 0) / h.length) : 0; };

// ---------- Sözleşmeler ----------
// Teklifler birkaç günde bir gelir, 7 gün içinde kabul edilmezse düşer. Aynı anda en fazla 3 sözleşme.
// seats: bir hatta her gün en az N koltuk (yön başına) sun. cargo: sürede N ton kargo taşı.
// pax: bir havalimanına/havalimanından sürede N yolcu taşı.
export const MAX_CONTRACTS = 3, OFFER_DAYS = 7, MAX_STRIKES = 3;
const CLIENTS = {
  seats: ['Güneş Tur', 'Mavi Yolculuk Turizm', 'Kervan Seyahat', 'Lale Tatil Köyleri', 'Yıldız Kongre Organizasyon'],
  cargo: ['Anadolu Lojistik', 'Hızlı Paket Kargo', 'Ekspres Taze Meyve', 'Kuzey Tekstil İhracat', 'Ilgın Eczane Deposu'],
  pax: ['Şehir Tanıtım Fonu', 'Bölge Turizm Birliği', 'Festival Komitesi', 'Ticaret Odası'],
};

// Sözleşme için hattın yön başına günlük koltuğu
export function routeSeats(S, r) {
  if (!r) return 0;
  return sim.routeEcon(r, S.fleet, doyOf(S), false, S).phys;
}

function scaleFloor(S, days, k) { return avgProfit(S) * days * k; }

function makeOffer(S) {
  const tier = sim.tierOf(S);
  const kinds = ['seats', 'seats', 'pax'];
  if (S.tier >= 2) kinds.push('cargo', 'cargo');
  const kind = pick(kinds);
  const taken = new Set([...(S.offers || []), ...(S.contracts || [])].map(o => o.key));
  if (kind === 'seats') {
    // Ya var olan bir hatta daha çok kapasite ya da üslerden henüz uçulmayan bir hat
    const fresh = Math.random() < 0.45;
    let a, b, cur = 0;
    if (fresh || !S.routes.length) {
      const base = AP[pick(S.bases)];
      const cands = AIRPORTS.filter(x => !sim.routeBlocker(S, base, x) && sim.demandPerDir(base, x, doyOf(S)) > 120);
      if (!cands.length) return null;
      const x = pick(cands.sort((p, q) => sim.demandPerDir(base, q, 180) - sim.demandPerDir(base, p, 180)).slice(0, 12));
      a = base.c; b = x.c;
    } else {
      const r = pick(S.routes); a = r.a; b = r.b; cur = routeSeats(S, r);
    }
    const key = 'seats:' + sim.pairKey(a, b);
    if (taken.has(key)) return null;
    const d = sim.distKm(AP[a], AP[b]);
    const typical = Math.max(140, 0.5 * sim.demandPerDir(AP[a], AP[b], doyOf(S)));
    const need = round(cur ? cur * rnd(1.25, 1.6) : Math.min(typical, rnd(200, 420) * (S.tier >= 2 ? 1.6 : 1)), 10);
    const days = pick([20, 30, 45]);
    const reward = round(Math.max(days * need * sim.baseFare(d) * 0.32, scaleFloor(S, days, 0.05)), 1e4);
    return { kind, key, a, b, need, days, reward, penalty: round(reward * 0.25, 1e4), client: pick(CLIENTS.seats),
      title: `${pairName(a, b)} koltuk anlaşması`,
      text: `${days} gün boyunca ${pairName(a, b)} hattında her gün yön başına en az ${num(need)} koltuk sun.` };
  }
  if (kind === 'cargo') {
    // Müşteri ek yük getirir: hattaki kargo talebi artar, darboğaz uçakların bölme kapasitesidir
    const rs = S.routes.filter(r => r.last && r.last.cargo > 0.5);
    if (!rs.length) return null;
    const r = pick(rs), key = 'cargo:' + sim.pairKey(r.a, r.b);
    if (taken.has(key)) return null;
    const d = sim.distKm(AP[r.a], AP[r.b]);
    const days = pick([15, 20, 30]);
    const cap = sim.routeEcon(r, S.fleet, doyOf(S), true, S).cargoCap;
    // Gereken toplam, bugünkü bölme kapasitesini en fazla %30 aşar (bir uçak ekleyerek yetişilir)
    const extra = Math.max(2, round(Math.min(r.last.cargo * rnd(0.6, 1.1), cap * 1.3 - r.last.cargo * 0.9), 1));
    const need = round((r.last.cargo * 0.9 + extra) * days, 10);
    const reward = round(Math.max(extra * days * sim.cargoRate(d) * 0.9, scaleFloor(S, days, 0.04)), 1e4);
    return { kind, key, a: r.a, b: r.b, extra, need, days, reward, penalty: round(reward * 0.2, 1e4), client: pick(CLIENTS.cargo),
      title: `${pairName(r.a, r.b)} kargo anlaşması`,
      text: `${days} gün boyunca ${pairName(r.a, r.b)} hattına günde ${num(extra)} ton ek yük getirir. Süre içinde hatta toplam ${num(need)} ton kargo taşı. Uçakların alt bölmesi yetmezse daha büyük uçak koy.` };
  }
  // pax: bir şehre yolcu
  const cands = AIRPORTS.filter(x => tier.zones.includes(x.z) && !S.bases.includes(x.c) && x.p >= 0.5);
  const ap = pick(cands);
  const key = 'pax:' + ap.c;
  if (taken.has(key)) return null;
  const days = pick([20, 30]);
  const cur = S.routes.filter(r => r.a === ap.c || r.b === ap.c).reduce((s, r) => s + (r.last ? r.last.pax : 0), 0);
  // Kampanya süresince o şehrin talebi +%25 olur
  const need = round((cur ? cur * rnd(1.12, 1.3) : rnd(150, 300) * (S.tier >= 2 ? 1.5 : 1)) * days, 1000);
  const reward = round(Math.max(need * 9, scaleFloor(S, days, 0.05)), 1e4);
  return { kind, key, ap: ap.c, need, days, reward, penalty: 0, rep: 1.04, client: pick(CLIENTS.pax),
    title: `${ap.n} tanıtım kampanyası`,
    text: `${days} gün içinde ${sim.AP[ap.c].n} havalimanına gelen ve giden toplam ${num(need)} yolcu taşı. Kampanya boyunca şehrin talebi %25 artar. Başarırsan itibarın da yükselir; başaramazsan ceza yok.` };
}

// Sözleşmenin bugünkü ilerlemesi
function progressToday(S, c) {
  if (c.kind === 'seats') return routeSeats(S, routeOn(S, c.a, c.b)) >= c.need - 0.5;
  if (c.kind === 'cargo') { const r = routeOn(S, c.a, c.b); return r && r.last ? r.last.cargo : 0; }
  return S.routes.filter(r => r.a === c.ap || r.b === c.ap).reduce((s, r) => s + (r.last ? r.last.pax + (r.last.tpax || 0) * 0.5 : 0), 0);
}

export function acceptOffer(S, id) {
  const o = (S.offers || []).find(x => x.id === id);
  if (!o || (S.contracts || []).length >= MAX_CONTRACTS) return null;
  S.offers = S.offers.filter(x => x !== o);
  const c = { ...o, start: S.day, end: S.day + o.days, prog: 0, strikes: 0 };
  S.contracts = [...(S.contracts || []), c];
  return c;
}
export function declineOffer(S, id) { S.offers = (S.offers || []).filter(x => x.id !== id); }

function finish(S, c, ok, news) {
  S.contracts = S.contracts.filter(x => x !== c);
  S.contractLog = [...(S.contractLog || []), { id: c.id, kind: c.kind, title: c.title, ok, day: S.day, reward: ok ? c.reward : -c.penalty }].slice(-40);
  if (ok) {
    S.cash += c.reward;
    if (c.rep) S.rep = Math.min(1.5, (S.rep || 1) * c.rep);
    S.contractsDone = (S.contractsDone || 0) + 1;
    news.push({ text: `Sözleşme tamamlandı: ${c.title}. ${c.client} ${money(c.reward)} ödedi.`, color: '#06d6a0', important: true, kind: 'contract', reward: c.reward });
  } else {
    S.cash -= c.penalty;
    S.rep = (S.rep || 1) * 0.98;
    news.push({ text: `Sözleşme başarısız: ${c.title}.${c.penalty ? ` ${c.client} ${money(c.penalty)} ceza kesti,` : ''} itibarın biraz düştü.`, color: '#ef476f', important: true, kind: 'contract' });
  }
}

export function dailyContracts(S) {
  const news = [];
  S.offers = (S.offers || []).filter(o => o.expires > S.day);
  S.contracts = S.contracts || [];
  for (const c of [...S.contracts]) {
    const p = progressToday(S, c);
    if (c.kind === 'seats') {
      if (p) c.prog++;
      else if (S.day > c.start + 1) { c.strikes++; if (c.strikes === 1) news.push({ text: `Uyarı: ${c.title} için koltuk yetmedi (${c.strikes}/${MAX_STRIKES}). Hatta uçak ekle.`, color: '#f8961e', important: true, kind: 'contract' }); }
      if (c.strikes >= MAX_STRIKES) finish(S, c, false, news);
      else if (c.prog >= c.days) finish(S, c, true, news);
    } else {
      c.prog += p;
      if (c.prog >= c.need) finish(S, c, true, news);
      else if (S.day >= c.end) finish(S, c, c.kind === 'pax' ? false : false, news);
    }
  }
  // Yeni teklif
  if (S.day >= 5 && S.routes.length >= 2 && S.offers.length < 3 && Math.random() < 0.14) {
    const o = makeOffer(S);
    if (o) {
      o.id = 'K' + S.seq++; o.expires = S.day + OFFER_DAYS;
      S.offers.push(o);
      news.push({ text: `Yeni sözleşme teklifi: ${o.client}, ${o.title} (${money(o.reward)}). Gelişim → Sözleşmeler.`, color: '#4cc9f0', important: false, kind: 'contract' });
    }
  }
  return news;
}

// ---------- Rakip satın alma ----------
// Rakibin değeri: kasası, uçakları ve kârlılığı. Satın alınca hatları ve uçakları (kiralık olarak) senin olur.
export function rivalValue(S, rv) {
  // Uçaklar kiralık: değerleri kira sözleşmesi ve marka kadar. Kasanın bir kısmı ödenir, borç fiyatı düşürür.
  const planes = rv.routes.reduce((s, r) => s + r.n * AC[r.type].price * 1e6 * 0.05, 0);
  return planes + Math.max(0, rv.avgProfit ?? rv.lastProfit ?? 0) * 120 + 0.1 * Math.max(0, rv.cash) - Math.max(0, -rv.cash);
}
export function acquireCost(S, rv) {
  const v = rivalValue(S, rv);
  const weak = rv.cash < 0 ? 0.8 : 1;   // zor durumdaki rakip ucuzlar
  return round(Math.max(20e6, v * 1.35 * weak), 1e6);
}
export function canAcquire(S, rv) {
  if (!rv.active) return 'Pazardan çekildi';
  if (S.tier < 2) return 'Ulusal lisans gerekir';
  const zones = sim.tierOf(S).zones;
  if (!zones.includes(AP[rv.hub].z)) return `${sim.tierForZone(AP[rv.hub].z).name} lisansı gerekir`;
  if (companyValue(S) < acquireCost(S, rv) * 1.5) return 'Şirket değerin bu satın alma için küçük';
  if (S.cash < acquireCost(S, rv)) return 'Kasada yeterli para yok';
  return null;
}
// Lisansın izin vermediği uçağı en yakın izinli tiple değiştir
function allowedType(S, type, d) {
  if (AC[type].tier <= S.tier) return type;
  const opts = AIRCRAFT.filter(a => a.tier <= S.tier && a.range >= d * 1.05).sort((x, y) => y.seats - x.seats);
  return opts[0] ? opts[0].id : null;
}
export function acquireRival(S, rv) {
  if (canAcquire(S, rv)) return null;
  const cost = acquireCost(S, rv);
  S.cash -= cost;
  const zones = sim.tierOf(S).zones;
  if (!S.bases.includes(rv.hub)) S.bases.push(rv.hub);
  let routes = 0, planes = 0;
  for (const rr of rv.routes) {
    const A = AP[rr.a], B = AP[rr.b], d = sim.distKm(A, B);
    if (!zones.includes(A.z) || !zones.includes(B.z) || routeOn(S, rr.a, rr.b)) continue;
    const type = allowedType(S, rr.type, d);
    if (!type) continue;
    const ids = [];
    for (let i = 0; i < rr.n; i++) {
      const f = { id: 'F' + S.seq++, type, leased: true, reg: nextReg(S), route: null, age: 365 * 4, cond: 85 };
      S.fleet.push(f); ids.push(f.id); planes++;
    }
    const r = addRoute(S, A, B, ids, rr.fareMul);
    r.age = rr.age || 30;
    routes++;
  }
  rv.active = false; rv.routes = []; rv.acquired = S.day;
  S.acquired = [...(S.acquired || []), rv.id];
  return { cost, routes, planes };
}

// ---------- Rozetler ----------
// Kalıcı başarımlar. Bir kez kazanılır, Rapor → Rozetler'de görünür.
const lastH = S => S.history.length ? S.history[S.history.length - 1] : {};
export const BADGES = [
  { id: 'first', icon: '🛫', name: 'İlk kalkış', text: 'İlk hattını aç', test: S => S.routes.length >= 1 },
  { id: 'profit1', icon: '💵', name: 'Kâra geçtik', text: 'Bir günü kârla kapat', test: S => lastH(S).profit > 0 },
  { id: 'week', icon: '📅', name: 'Hep kârda', text: '30 gün üst üste kâr et', test: S => S.history.length >= 30 && S.history.slice(-30).every(h => h.profit > 0) },
  { id: 'full', icon: '🎟️', name: 'Kapalı gişe', text: '5 hatta aynı gün %98 doluluk', test: S => S.routes.filter(r => r.last && r.last.load >= 0.98).length >= 5 },
  { id: 'net10', icon: '🕸️', name: 'Ağ kurucusu', text: '10 hat işlet', test: S => S.routes.length >= 10 },
  { id: 'net50', icon: '🌐', name: 'Örümcek ağı', text: '50 hat işlet', test: S => S.routes.length >= 50 },
  { id: 'fleet50', icon: '✈️', name: 'Filo komutanı', text: '50 uçaklık filo', test: S => S.fleet.length >= 50 },
  { id: 'own10', icon: '🔑', name: 'Mülk sahibi', text: '10 uçağın sahibi ol', test: S => S.fleet.filter(f => !f.leased).length >= 10 },
  { id: 'hub', icon: '🔀', name: 'Aktarma ustası', text: 'Bir günde 1.000 aktarmalı yolcu', test: S => (lastH(S).tpax || 0) >= 1000 },
  { id: 'cargo1k', icon: '📦', name: 'Kargocu', text: 'Toplam 1.000 ton kargo taşı', test: S => (S.totalCargo || 0) >= 1000 },
  { id: 'cargo50k', icon: '🚚', name: 'Lojistik devi', text: 'Toplam 50.000 ton kargo taşı', test: S => (S.totalCargo || 0) >= 5e4 },
  { id: 'deal1', icon: '🤝', name: 'Söz verdik', text: 'İlk sözleşmeni tamamla', test: S => (S.contractsDone || 0) >= 1 },
  { id: 'deal10', icon: '📜', name: 'Güvenilir ortak', text: '10 sözleşme tamamla', test: S => (S.contractsDone || 0) >= 10 },
  { id: 'share', icon: '🥇', name: 'Pazar lideri', text: 'Toplam pazar payında %50', test: S => (lastH(S).mshare || 0) >= 0.5 && S.day > 30 },
  { id: 'bust', icon: '💥', name: 'Rekabetin sonu', text: 'Bir rakip iflas etsin', test: S => (S.rivals || []).some(r => !r.active && !r.acquired) },
  { id: 'buy', icon: '🏢', name: 'Şirket avcısı', text: 'Bir rakibi satın al', test: S => (S.acquired || []).length >= 1 },
  { id: 'buy3', icon: '👑', name: 'Tekel', text: 'Üç rakibi satın al', test: S => (S.acquired || []).length >= 3 },
  { id: 'abroad', icon: '🗺️', name: 'Sınır ötesi', text: 'İlk yurt dışı hattı', test: S => S.routes.some(r => AP[r.a].co !== AP[r.b].co) },
  { id: 'cont', icon: '🌍', name: 'Kıtalararası', text: 'Dünya bölgesine bir hat', test: S => S.routes.some(r => AP[r.a].z === 'W' || AP[r.b].z === 'W') },
  { id: 'far', icon: '🧭', name: 'Dünyanın öbür ucu', text: '10.000 km\'den uzun bir hat', test: S => S.routes.some(r => sim.distKm(AP[r.a], AP[r.b]) >= 1e4) },
  { id: 'pax1m', icon: '👥', name: 'Milyonluk', text: '1 milyon yolcu', test: S => S.totalPax >= 1e6 },
  { id: 'pax10m', icon: '🏟️', name: 'Bir ülke kadar', text: '10 milyon yolcu', test: S => S.totalPax >= 1e7 },
  { id: 'day1m', icon: '💰', name: 'Milyon dolarlık gün', text: 'Bir günde 1 M$ kâr', test: S => lastH(S).profit >= 1e6 },
  { id: 'val1b', icon: '💎', name: 'Unicorn', text: 'Şirket değeri 1 milyar $', test: S => companyValue(S) >= 1e9 },
  { id: 'nodebt', icon: '🧾', name: 'Borçsuz', text: 'Krediyi erken kapat', test: S => (S.loansRepaid || 0) >= 1 },
  { id: 'storm', icon: '⛈️', name: 'Fırtınaya rağmen', text: 'Hava olayı sürerken rekor kâr', test: S => S.records && S.records.profit && S.records.profit.day === S.day && sim.activeEvents(S).some(e => e.kind === 'weather') },
  { id: 'fresh', icon: '🧼', name: 'Pırıl pırıl', text: '20+ uçaklık filonun ortalama durumu %90 üstü', test: S => S.fleet.length >= 20 && S.fleet.reduce((s, f) => s + sim.condOf(f), 0) / S.fleet.length >= 90 },
  { id: 'star', icon: '⭐', name: 'Holding', text: 'İlk Holding yıldızı', test: S => sim.stars(S) >= 1 },
];

export function checkBadges(S) {
  S.badges = S.badges || {};
  const out = [];
  for (const b of BADGES) {
    if (S.badges[b.id]) continue;
    let ok = false;
    try { ok = b.test(S); } catch (_) { /* eski kayıt */ }
    if (ok) { S.badges[b.id] = S.day; out.push(b); }
  }
  return out;
}
