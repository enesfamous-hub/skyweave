// İlerleme sistemleri: yükseltmeler, görevler, otomasyon (müdürler), çevrimdışı kazanç, prestij (holding).
import { AIRPORTS } from './data.js';
import { AP, AC, distKm, routeEcon, routeBlocker, rivalsOnPair, rivalRouteSeats, pairKey, demandPerDir, dayOfYear, gameDate, lvl } from './sim.js';

const money = n => n <= 0 ? '$0' : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : `$${Math.round(n / 1e3)}K`;

// ---------- Yükseltmeler ----------
export const UPGRADES = [
  { id: 'fuel',   name: 'Yakıt verimliliği',     max: 5, base: 400e3, tier: 1, desc: L => `Yakıt tüketimi −%${4 * L}` },
  { id: 'turn',   name: 'Hızlı yer hizmeti',     max: 4, base: 600e3, tier: 1, desc: L => `Yerde bekleme −%${8 * L}, günde daha çok sefer` },
  { id: 'crew',   name: 'Ekip eğitimi',          max: 5, base: 500e3, tier: 1, desc: L => `Ekip ve bakım saat maliyeti −%${4 * L}` },
  { id: 'maint',  name: 'Bakım hangarı',         max: 5, base: 800e3, tier: 1, desc: L => `Uçak kira ve bakım gideri −%${6 * L}` },
  { id: 'lounge', name: 'VIP salon ve ikram',    max: 5, base: 700e3, tier: 1, desc: L => `İtibar +%${3 * L} (rakiplere karşı pazar payı)` },
  { id: 'launch', name: 'Açılış kampanyaları',   max: 4, base: 500e3, tier: 1, desc: L => `Yeni hat talebi %${40 + 10 * L}'tan başlar, ${Math.round(30 * (1 - 0.15 * L))} günde dolar` },
  { id: 'night',  name: 'Gece vardiyası müdürü', max: 5, base: 300e3, tier: 1, desc: L => `Çevrimdışı kazanç ${8 + 2 * L} saate kadar, verim %${50 + 10 * L}` },
  { id: 'mkt',    name: 'Sadakat programı',      max: 5, base: 900e3, tier: 2, desc: L => `Tüm hatlarında talep +%${3 * L}` },
];
export const upgradeCost = (u, L) => Math.round(u.base * Math.pow(2.3, L) / 1000) * 1000;
export const totalUpgrades = S => Object.values(S.upgrades || {}).reduce((s, x) => s + x, 0);

export function buyUpgrade(S, id) {
  const u = UPGRADES.find(x => x.id === id), L = lvl(S, id);
  if (!u || L >= u.max || S.tier < u.tier) return false;
  const cost = upgradeCost(u, L);
  if (S.cash < cost) return false;
  S.cash -= cost;
  S.upgrades = S.upgrades || {};
  S.upgrades[id] = L + 1;
  return true;
}

// ---------- Müdürler (otomasyon) ----------
export const MANAGERS = [
  { id: 'pricing', name: 'Gelir müdürü',  cost: 1e6,   salary: 2000, tier: 1, desc: 'Her hafta tüm hatlarının bilet fiyatını doluluğa göre ayarlar: dolu hatta zam, boş hatta indirim.' },
  { id: 'fleet',   name: 'Filo müdürü',   cost: 1.5e6, salary: 3000, tier: 1, desc: 'Her gün boştaki uçaklarını, talebi koltuktan fazla olan hatlarına atar.' },
  { id: 'network', name: 'Ağ planlayıcı', cost: 4e6,   salary: 6000, tier: 2, desc: 'Boşta uçak kalırsa üslerinden en çok talep gören yeni hattı kendisi açar.' },
];
export const hasManager = (S, id) => !!(S.managers && S.managers[id] && S.managers[id].on);

export function hireManager(S, id) {
  const m = MANAGERS.find(x => x.id === id);
  if (!m || S.cash < m.cost || S.tier < m.tier) return false;
  S.cash -= m.cost;
  S.managers = S.managers || {};
  S.managers[id] = { on: true, salary: m.salary };
  return true;
}

// Gelir müdürü (haftalık): fiyatları doluluğa göre ayarla
function runPricing(S) {
  let changed = 0;
  const doy = dayOfYear(gameDate(S.t));
  for (const r of S.routes) {
    if (!r.last || !r.planes.length) continue;
    const e = routeEcon(r, S.fleet, doy, false, S);
    let f = r.fareMul;
    if (e.load > 0.97 && e.demand * e.share > e.seats * 1.1) f += 0.05;
    else if (e.load < 0.75) f -= 0.05;
    f = Math.round(Math.min(1.5, Math.max(0.7, f)) * 20) / 20;
    if (f !== r.fareMul) { r.fareMul = f; changed++; }
  }
  return changed ? [{ text: `Gelir müdürü ${changed} hattın bilet fiyatını ayarladı.`, color: '#ffd166', kind: 'auto' }] : [];
}

// Filo müdürü (günlük): boştaki uçakları en çok koltuk ihtiyacı olan hatta ata
function runFleet(S) {
  const news = [];
  const doy = dayOfYear(gameDate(S.t));
  for (const f of S.fleet.filter(x => !x.route)) {
    let best = null, bestNeed = 0;
    for (const r of S.routes) {
      const d = distKm(AP[r.a], AP[r.b]);
      if (AC[f.type].range < d) continue;
      const e = routeEcon(r, S.fleet, doy, true, S);
      const need = e.demand * Math.max(e.share, 0.3) - e.seats;
      if (e.load > 0.95 && need > bestNeed) { bestNeed = need; best = r; }
    }
    if (best && bestNeed > AC[f.type].seats) {
      best.planes.push(f.id); f.route = best.id;
      news.push({ text: `Filo müdürü ${AC[f.type].name} (${f.reg}) uçağını ${AP[best.a].n}–${AP[best.b].n} hattına atadı.`, color: '#ffd166', kind: 'auto' });
    }
  }
  return news;
}

// Ağ planlayıcı (günlük): boşta uçak kaldıysa yeni hat aç
function runNetwork(S, openRoute) {
  const news = [];
  const idle = S.fleet.filter(x => !x.route);
  if (!idle.length || S.cash < 0) return news;
  const doy = dayOfYear(gameDate(S.t));
  for (const f of idle) {
    const ac = AC[f.type];
    let best = null, bestScore = 0;
    for (const bc of S.bases) {
      const a = AP[bc];
      for (const b of AIRPORTS) {
        if (routeBlocker(S, a, b)) continue;
        const d = distKm(a, b);
        if (ac.range < d) continue;
        const D0 = demandPerDir(a, b, doy, 1);
        const rivalSeats = rivalsOnPair(S, a.c, b.c).reduce((s, x) => s + rivalRouteSeats(x.rr, S), 0);
        const score = Math.min(D0 - rivalSeats * 0.7, ac.seats * 6) * Math.min(1, d / 500);
        if (score > bestScore) { bestScore = score; best = { a, b }; }
      }
    }
    if (best && bestScore > ac.seats) {
      openRoute(best.a, best.b, [f.id]);
      news.push({ text: `Ağ planlayıcı yeni hat açtı: ${best.a.n}–${best.b.n} (${ac.name}).`, color: '#ffd166', kind: 'auto', important: true });
    }
  }
  return news;
}

// Gün sonunda çağrılır. openRoute(a, b, planeIds): main tarafındaki sessiz hat açma.
export function runManagers(S, openRoute) {
  const news = [];
  if (hasManager(S, 'fleet')) news.push(...runFleet(S));
  if (hasManager(S, 'network')) news.push(...runNetwork(S, openRoute));
  if (hasManager(S, 'pricing') && S.day % 7 === 0) news.push(...runPricing(S));
  return news;
}

// ---------- Görevler ----------
const lastProfit = S => S.history.length ? S.history[S.history.length - 1].profit : 0;
const G = (id, text, target, val, reward) => ({ id, text, target, val, reward });
export const GOALS = [
  G('fleet1', 'İlk uçağını kirala', 1, S => S.fleet.length, 200e3),
  G('route1', 'İlk hattını aç', 1, S => S.routes.length, 300e3),
  G('pax1k', '1.000 yolcu taşı', 1000, S => S.totalPax, 300e3),
  G('route3', '3 hat işlet', 3, S => S.routes.length, 500e3),
  G('up1', 'İlk yükseltmeni al', 1, S => totalUpgrades(S), 400e3),
  G('fleet5', 'Filonu 5 uçağa çıkar', 5, S => S.fleet.length, 600e3),
  G('pax10k', '10.000 yolcu taşı', 1e4, S => S.totalPax, 800e3),
  G('profit20k', 'Bir günde $20K kâr et', 20e3, lastProfit, 1e6),
  G('mgr1', 'Bir müdür işe al', 1, S => Object.keys(S.managers || {}).length, 800e3),
  G('tier2', 'Ulusal lisansı al', 2, S => S.tier, 1.5e6),
  G('share50', 'Rakipli bir hatta %50 pazar payına ulaş', 1, S => S.routes.some(r => r.last && r.last.share >= 0.5 && rivalsOnPair(S, r.a, r.b).length) ? 1 : 0, 1e6),
  G('base2', 'İkinci üssünü kur', 2, S => S.bases.length, 1e6),
  G('own1', 'Bir uçak satın al (kiralık değil)', 1, S => S.fleet.filter(f => !f.leased).length, 2e6),
  G('pax50k', '50.000 yolcu taşı', 5e4, S => S.totalPax, 2e6),
  G('route10', '10 hat işlet', 10, S => S.routes.length, 3e6),
  G('profit100k', 'Bir günde $100K kâr et', 1e5, lastProfit, 4e6),
  G('up10', 'Toplam 10 yükseltme seviyesine ulaş', 10, S => totalUpgrades(S), 3e6),
  G('tier3', 'Kıtasal lisansı al', 3, S => S.tier, 8e6),
  G('intl1', 'İlk yurt dışı hattını aç', 1, S => S.routes.filter(r => AP[r.a].co !== AP[r.b].co).length, 5e6),
  G('fleet20', 'Filonu 20 uçağa çıkar', 20, S => S.fleet.length, 8e6),
  G('pax500k', '500.000 yolcu taşı', 5e5, S => S.totalPax, 10e6),
  G('profit500k', 'Bir günde $500K kâr et', 5e5, lastProfit, 15e6),
  G('tier4', 'Uluslararası lisansı al', 4, S => S.tier, 30e6),
  G('wide1', 'Kıtalararası bir hat aç', 1, S => S.routes.filter(r => AP[r.a].z === 'W' || AP[r.b].z === 'W').length, 20e6),
  G('pax3m', '3 milyon yolcu taşı', 3e6, S => S.totalPax, 40e6),
];

export function goalState(S) {
  const done = new Set(S.goalsDone || []);
  const open = GOALS.filter(g => !done.has(g.id));
  const active = open.slice(0, 3).map(g => {
    const v = g.val(S);
    return { ...g, cur: Math.min(v, g.target), ready: v >= g.target };
  });
  return { active, doneCount: done.size, total: GOALS.length, claimable: active.filter(g => g.ready).length };
}

export function claimGoal(S, id) {
  const g = GOALS.find(x => x.id === id);
  if (!g || (S.goalsDone || []).includes(id) || g.val(S) < g.target) return 0;
  S.goalsDone = [...(S.goalsDone || []), id];
  S.cash += g.reward;
  return g.reward;
}

// Yeni tamamlanabilir hale gelen görevler (bir kez bildirilir)
export function newlyReady(S) {
  S.goalsNotified = S.goalsNotified || [];
  const out = [];
  for (const g of goalState(S).active) {
    if (g.ready && !S.goalsNotified.includes(g.id)) { S.goalsNotified.push(g.id); out.push(g); }
  }
  return out;
}

// ---------- Çevrimdışı kazanç ----------
// Oyun saati çevrimdışıyken durur. Kazanç son 7 günün ortalamasına göre hesaplanır.
export const OFFLINE_DAYS_PER_MIN = 0.25;
export function offlineEarnings(S, ms) {
  const minutes = ms / 60000;
  if (minutes < 2 || !S.history.length) return null;
  const L = lvl(S, 'night');
  const capH = 8 + 2 * L, eff = 0.5 + 0.1 * L;
  const mins = Math.min(minutes, capH * 60);
  const hist = S.history.slice(-7);
  const avgProfit = hist.reduce((s, h) => s + h.profit, 0) / hist.length;
  const avgPax = hist.reduce((s, h) => s + h.pax, 0) / hist.length;
  if (avgProfit <= 0) return { minutes, capH, eff, money: 0, pax: 0, noProfit: true };
  const days = mins * OFFLINE_DAYS_PER_MIN;
  return { minutes, capped: minutes > capH * 60, capH, eff, days, money: avgProfit * days * eff, pax: Math.round(avgPax * days * eff) };
}

// ---------- Prestij: Holding kur ----------
export function companyValue(S) {
  const owned = S.fleet.filter(f => !f.leased).reduce((s, f) => s + AC[f.type].price * 1e6 * 0.7, 0);
  const hist = S.history.slice(-7);
  const avg = hist.length ? hist.reduce((s, h) => s + h.profit, 0) / hist.length : 0;
  return S.cash + owned + Math.max(0, avg) * 180;
}
export const starsFor = S => Math.floor(Math.sqrt(Math.max(0, companyValue(S)) / 25e6));
export const canPrestige = S => S.tier >= 3 && starsFor(S) >= 1;
export const legacyStars = S => (S.legacy && S.legacy.stars) || 0;
export const prestigeText = s => `Gelir +%${5 * s} · başlangıç kasası +${money(1e6 * s)}`;
