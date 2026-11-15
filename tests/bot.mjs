// Denge testleri için "makul bir oyuncu" gibi davranan bot.
// Bilerek kusursuz değil: ortalama bir oyuncunun yapacağı kararları verir.
import { AIRPORTS, AIRCRAFT, TIERS } from '../js/data.js';
import * as sim from '../js/sim.js';
import * as P from '../js/progress.js';
import * as D from '../js/depth.js';
import * as X from '../js/extra.js';
import { decide, decisionView } from '../js/events.js';
import { newState, addRoute, advanceDay, nextReg } from '../js/game.js';
import { applyScenario, SCENARIOS } from '../js/scenarios.js';

const { AP, AC } = sim;

// Tekrarlanabilir rastgelelik
export function seedRandom(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const doy = S => sim.dayOfYear(sim.gameDate(S.t));
const types = S => AIRCRAFT.filter(a => a.tier <= S.tier);

function lease(S, ac) {
  const dep = sim.leasePerDay(ac) * 30;
  if (S.cash < dep) return null;
  S.cash -= dep;
  const f = { id: 'F' + S.seq++, type: ac.id, leased: true, reg: nextReg(S), route: null, age: 0, cond: 100 };
  S.fleet.push(f);
  return f;
}

// Bir hatta bir uçak daha (ya da ilk uçak) eklemenin günlük net katkısı
function marginal(S, a, b, ac, route = null) {
  const tmp = { id: '_tmp', type: ac.id, leased: true, age: 0, cond: 100 };
  const fleet = [...S.fleet, tmp];
  const r = route ? { ...route, planes: [...route.planes, '_tmp'] } : { id: '_r', a: a.c, b: b.c, fareMul: 1, planes: ['_tmp'], age: 0, cabin: 0 };
  const after = sim.routeEcon(r, fleet, doy(S), true, S);
  const before = route ? sim.routeEcon(route, S.fleet, doy(S), true, S).net : 0;
  return after.net - before;
}

// Bot (testler) için: makul teklifleri kabul et
function botContracts(S) {
  for (const o of [...(S.offers || [])]) {
    if ((S.contracts || []).length >= X.MAX_CONTRACTS) break;
    const ok = o.kind !== 'seats' || X.routeOn(S, o.a, o.b);
    const paxOk = o.kind !== 'pax' || S.routes.some(r => r.a === o.ap || r.b === o.ap);
    if (ok && paxOk && Math.random() < 0.6) X.acceptOffer(S, o.id);
  }
  // Koltuk sözleşmesi için hatta uçak ekle
  for (const c of S.contracts || []) {
    if (c.kind !== 'seats' || c.strikes >= 2) continue;
    const r = X.routeOn(S, c.a, c.b);
    if (!r || X.routeSeats(S, r) >= c.need || (c.added || 0) >= 3) continue;
    c.added = (c.added || 0) + 1;
    const f0 = S.fleet.find(f => f.id === r.planes[0]);
    if (!f0) continue;
    const ac = AC[f0.type], dep = sim.leasePerDay(ac) * 30;
    if (S.cash < dep * 3) continue;
    S.cash -= dep;
    const f = { id: 'F' + S.seq++, type: ac.id, leased: true, reg: nextReg(S), route: r.id, age: 0, cond: 100 };
    S.fleet.push(f); r.planes.push(f.id);
  }
  // Uygun rakibi satın al
  for (const rv of S.rivals || []) if (!X.canAcquire(S, rv) && S.cash > X.acquireCost(S, rv) * 1.3) X.acquireRival(S, rv);
}

export function botDay(S, opt = {}) {
  let reserve = opt.reserve ?? 1.5e6;
  // Lisans için yolcu tamamsa parayı biriktir
  const nx = TIERS[S.tier];
  if (nx && S.totalPax >= nx.pax) reserve += nx.fee;
  // Görev ödülleri
  for (const g of P.goalState(S).active) if (g.ready) P.claimGoal(S, g.id);
  // Karar olayları: rastgele ama makul
  if (S.pendingDecision) {
    const v = decisionView(S);
    const ok = v.options.map((o, i) => o.disabled ? -1 : i).filter(i => i >= 0);
    decide(S, ok[Math.floor(Math.random() * ok.length)] ?? v.options.length - 1);
  }
  // Sözleşme teklifleri
  botContracts(S);
  // Lisans
  const next = TIERS[S.tier];
  if (next && S.totalPax >= next.pax && S.cash >= next.fee + reserve) { S.cash -= next.fee; S.tier = next.id; }
  // Müdürler
  for (const id of ['pricing', 'tech', 'fleet']) {
    const m = P.MANAGERS.find(x => x.id === id);
    if (!P.hasManager(S, id) && S.tier >= m.tier && S.cash > m.cost * 3 + reserve && S.routes.length >= 3) P.hireManager(S, id);
  }
  // Yükseltmeler: en ucuzu, kasa rahatsa
  const ups = P.UPGRADES.filter(u => S.tier >= u.tier && sim.lvl(S, u.id) < u.max).map(u => ({ u, c: P.upgradeCost(u, sim.lvl(S, u.id)) })).sort((x, y) => x.c - y.c);
  if (ups[0] && S.cash > ups[0].c * 2.5 + reserve) P.buyUpgrade(S, ups[0].u.id);
  // Fiyat ayarı (gelir müdürü yoksa, haftada bir)
  if (!P.hasManager(S, 'pricing') && S.day % 7 === 3) for (const r of S.routes) {
    if (!r.last) continue;
    if (r.last.load > 0.97) r.fareMul = Math.min(1.5, r.fareMul + 0.05);
    else if (r.last.load < 0.7) r.fareMul = Math.max(0.7, r.fareMul - 0.05);
  }
  // Bakım (teknik müdür yoksa)
  if (!P.hasManager(S, 'tech')) for (const f of S.fleet) if (sim.condOf(f) < 66 && D.canCheck(S, f) && S.cash > sim.checkCost(f) * 3) D.startCheck(S, f);
  // Uzun hatlarda business sınıfı
  for (const r of S.routes) if (!r.cabin && sim.distKm(AP[r.a], AP[r.b]) > 1800 && S.tier >= 3) r.cabin = 1;

  // Büyüme: en iyi yeni hat ya da mevcut hatta ek uçak (günde en fazla 2 hamle)
  for (let k = 0; k < 2; k++) {
    if (S.cash < reserve) break;
    let best = null;
    // Gerçek oyuncu her şeyi denemez: her gün rastgele 25 hedef havalimanına bakar
    const sample = AIRPORTS.filter(() => Math.random() < 25 / AIRPORTS.length);
    for (const ac of types(S)) {
      const dep = sim.leasePerDay(ac) * 30;
      if (S.cash < dep + reserve) continue;
      for (const r of S.routes) {
        const d = sim.distKm(AP[r.a], AP[r.b]);
        if (ac.range < d || !r.last || r.last.load < 0.9) continue;
        const need = sim.planeDeps(S, d, ac.id);
        if (sim.slotFree(S, r.a) < need || sim.slotFree(S, r.b) < need) continue;
        const g = marginal(S, null, null, ac, r);
        if (!best || g > best.g) best = { g, ac, r };
      }
      for (const bc of S.bases.slice(0, 6)) {
        const a = AP[bc];
        for (const b of sample) {
          if (sim.routeBlocker(S, a, b)) continue;
          const d = sim.distKm(a, b);
          if (ac.range < d) continue;
          const need = sim.planeDeps(S, d, ac.id);
          if (sim.slotFree(S, a.c) < need || sim.slotFree(S, b.c) < need) continue;
          const g = marginal(S, a, b, ac) * 0.85; // yeni hat yavaş dolar
          if (!best || g > best.g) best = { g, ac, a, b };
        }
      }
    }
    if (!best || best.g < 2000) break;
    const f = lease(S, best.ac);
    if (!f) break;
    if (best.r) { best.r.planes.push(f.id); f.route = best.r.id; }
    else addRoute(S, best.a, best.b, [f.id]);
  }
  // Slot paketi: slotu dolan kârlı havalimanında
  for (const r of S.routes) for (const c of [r.a, r.b]) {
    if (sim.slotFactor(S, c) < 1 && S.cash > sim.slotPackPrice(S, c) * 2 + reserve) { S.slots[c] = (S.slots[c] || 0) + 1; S.cash -= sim.slotPackPrice(S, c) / 1.25; }
  }
  // Yeni üs
  if (S.cash > sim.baseCost(S) * 4 + reserve && S.routes.length >= 5 * S.bases.length) {
    const zones = sim.tierOf(S).zones;
    const cand = AIRPORTS.filter(a => zones.includes(a.z) && !S.bases.includes(a.c)).sort((x, y) => y.p - x.p)[0];
    if (cand) { S.cash -= sim.baseCost(S); S.bases.push(cand.c); }
  }
  // Kasa çok dolunca kiralık uçakları satın al (gider düşer)
  if (S.cash > 60e6) {
    const f = S.fleet.find(x => x.leased);
    if (f && S.cash > AC[f.type].price * 1e6 * 1.5 + reserve) { S.cash -= AC[f.type].price * 1e6; f.leased = false; delete f.leaseDay; }
  }
  // Zarar eden hattan fazla uçağı iade et (haftada bir)
  if (S.day % 7 === 5) for (const r of S.routes) {
    if (!r.last || r.last.net >= 0 || r.planes.length < 2) continue;
    if ((S.contracts || []).some(c => c.kind === 'seats' && sim.pairKey(c.a, c.b) === sim.pairKey(r.a, r.b))) continue;
    const id = r.planes.pop();
    const f = S.fleet.find(x => x.id === id);
    if (f && f.leased) S.fleet = S.fleet.filter(x => x !== f); else if (f) f.route = null;
  }
  if (opt.extra) opt.extra(S);
}

// Tüm oyunu oynat. Her gün bir satır istatistik döner.
export function runGame({ seed = 1, days = 720, base = 'IST', bot = true, onDay, scenario } = {}) {
  seedRandom(seed);
  const sc = scenario && SCENARIOS.find(x => x.id === scenario);
  if (sc && sc.base) base = sc.base;
  const S = newState('Test Hava', base);
  if (sc) applyScenario(S, scenario);
  S.firstBase = base;
  D.refreshUsed(S);
  const log = [];
  const tierDay = { 1: 0 };
  for (let i = 0; i < days && !S.over; i++) {
    if (bot) botDay(S);
    S.t = 9 + 24 * S.day;
    const out = advanceDay(S);
    if (S.tier && tierDay[S.tier] == null) tierDay[S.tier] = S.day;
    log.push({ day: S.day, cash: S.cash, profit: out.rec.profit, pax: out.rec.pax, tier: S.tier, fleet: S.fleet.length, routes: S.routes.length, value: P.companyValue(S) });
    if (out.scenario && !S.scenarioResult) S.scenarioResult = { ...out.scenario, day: S.day, sc: undefined };
    if (onDay) onDay(S, out);
    if (S.cash < sim.BANKRUPT) S.over = true;
  }
  return { S, log, tierDay };
}
