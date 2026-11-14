// Derinlik sistemleri: uçak yaşlanması ve bakım, ikinci el pazarı, finans (kredi, hisse).
import { AIRCRAFT } from './data.js';
import * as sim from './sim.js';
import { companyValue } from './progress.js';

const { AC } = sim;
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- Filo: yaşlanma, yıpranma, arıza ----------
// Gün sonunda çağrılır (settleDay sonrası). Haber listesi döner.
export function dailyFleet(S) {
  const news = [];
  for (const f of S.fleet) {
    f.age = (f.age || 0) + 1;
    if (f.cond == null) f.cond = 100;
    if (f.down && f.down.until <= S.day) {
      if (f.down.why === 'check') news.push({ text: `${AC[f.type].name} (${f.reg}) ağır bakımdan çıktı, uçuşlara döndü.`, color: '#06d6a0', kind: 'fleet' });
      f.down = null;
    }
    if (sim.isDown(S, f) || !f.route) continue;
    // Uçan uçak yıpranır. Yaşlı uçak daha hızlı yıpranır.
    f.cond = Math.max(0, f.cond - (0.07 + 0.002 * sim.ageYears(f)) * (S.cheapMaint ? 1.4 : 1));
    // Durumu kötü uçakta arıza (AOG) riski
    const p = Math.max(0, 65 - f.cond) / 1500;
    if (p && Math.random() < p) {
      const days = 2 + Math.floor(Math.random() * 3), cost = Math.round(sim.checkCost(f) * 0.15);
      f.down = { until: S.day + days, why: 'aog' };
      S.cash -= cost;
      S.rep = (S.rep || 1) * 0.995;
      news.push({ text: `Arıza: ${AC[f.type].name} (${f.reg}) ${days} gün yerde kalacak. Onarım ${fmt(cost)}. Ağır bakım zamanı gelmiş olabilir.`, color: '#ef476f', important: true, kind: 'fleet' });
    }
  }
  if (!S.used || S.day - (S.usedDay || 0) >= 14 || S.usedTier !== S.tier) refreshUsed(S);
  return news;
}

const fmt = n => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;

// Ağır bakım (C-check): uçak birkaç gün yerde kalır, durumu yenilenir.
export function canCheck(S, f) { return !sim.isDown(S, f) && S.cash >= sim.checkCost(f) && sim.condOf(f) < 97; }
export function startCheck(S, f) {
  if (!canCheck(S, f)) return false;
  S.cash -= sim.checkCost(f);
  f.down = { until: S.day + sim.CHECK_DAYS, why: 'check' };
  f.cond = sim.checkRestores(f);
  S.checks = (S.checks || 0) + 1;
  return true;
}

// Teknik müdür: durumu %60'ın altına düşen uçağı bakıma alır (günde en fazla bir uçak).
export function runTech(S) {
  const f = S.fleet.filter(x => !sim.isDown(S, x) && sim.condOf(x) < 60).sort((a, b) => sim.condOf(a) - sim.condOf(b))[0];
  if (!f || S.cash < sim.checkCost(f) * 2) return [];
  startCheck(S, f);
  return [{ text: `Teknik müdür ${AC[f.type].name} (${f.reg}) uçağını ağır bakıma aldı (${sim.CHECK_DAYS} gün).`, color: '#ffd166', kind: 'auto' }];
}

// ---------- İkinci el pazarı ----------
export function refreshUsed(S) {
  const types = AIRCRAFT.filter(a => a.tier <= S.tier);
  S.used = [];
  for (let i = 0; i < 5; i++) {
    const ac = types[Math.floor(Math.random() * types.length)];
    const years = rnd(3, 22), cond = Math.round(rnd(55, 92));
    const f = { type: ac.id, age: Math.round(years * 365), cond };
    S.used.push({
      id: 'U' + S.seq++, type: ac.id, age: f.age, cond,
      price: Math.round(sim.planeValue(f) * 1.1 / 1e4) * 1e4,
      leaseDay: Math.round(sim.leasePerDay(ac) * (0.55 + 0.45 * Math.pow(0.94, years))),
    });
  }
  S.usedDay = S.day; S.usedTier = S.tier;
}

// ---------- Finans ----------
export const LOAN_TERMS = [180, 360, 720];
export const debt = S => (S.loans || []).reduce((s, l) => s + l.principal, 0);
export const grossValue = S => companyValue(S) + debt(S);
export const leverage = S => { const g = grossValue(S); return g > 0 ? Math.min(1, debt(S) / g) : 1; };
export function loanRate(S, days = 360) {
  return 0.05 + 0.14 * leverage(S) + (S.cash < 0 ? 0.03 : 0) + (days > 360 ? 0.01 : days < 360 ? -0.005 : 0) - 0.005 * (S.tier - 1);
}
export const creditLimit = S => Math.max(0, Math.max(4e6, 0.6 * Math.max(0, grossValue(S))) - debt(S));
export function rating(S) {
  if (S.cash < 0) return 'CCC';
  const l = leverage(S);
  return l < 0.1 ? 'AAA' : l < 0.25 ? 'AA' : l < 0.4 ? 'A' : l < 0.55 ? 'BBB' : l < 0.7 ? 'BB' : 'B';
}
export function loanPayment(P, rate, days) {
  const i = rate / 365;
  return P * i / (1 - Math.pow(1 + i, -days));
}
export function takeLoan(S, amount, days) {
  amount = Math.round(Math.min(amount, creditLimit(S)) / 1e5) * 1e5;
  if (amount < 1e5) return null;
  const rate = loanRate(S, days);
  const l = { id: 'L' + S.seq++, amount, principal: amount, rate, days, left: days, pay: loanPayment(amount, rate, days) };
  S.loans = [...(S.loans || []), l];
  S.cash += amount;
  return l;
}
export function repayLoan(S, id) {
  const l = (S.loans || []).find(x => x.id === id);
  if (!l || S.cash < l.principal) return false;
  S.cash -= l.principal;
  S.loans = S.loans.filter(x => x !== l);
  return true;
}

// Hisse: Ulusal lisanstan sonra halka arz. %10'luk dilimlerle en fazla %40 satılabilir.
export const SHARE_STEP = 0.1, MAX_FLOAT = 0.4, DIVIDEND = 0.35;
export const canIPO = S => S.tier >= 2 && companyValue(S) >= 20e6;
export const sharePrice = S => Math.max(0, companyValue(S)) / 1e8; // 100 milyon hisse
export const sellValue = S => Math.max(0, companyValue(S)) * SHARE_STEP * 0.92;
export const buyBackCost = S => Math.max(0, companyValue(S)) * SHARE_STEP * 1.1;
export function sellShares(S) {
  if (!canIPO(S) || (S.float || 0) >= MAX_FLOAT - 1e-9) return 0;
  const v = sellValue(S);
  S.cash += v; S.float = Math.round(((S.float || 0) + SHARE_STEP) * 100) / 100;
  return v;
}
export function buyBack(S) {
  if (!(S.float > 0)) return 0;
  const c = buyBackCost(S);
  if (S.cash < c) return 0;
  S.cash -= c; S.float = Math.max(0, Math.round((S.float - SHARE_STEP) * 100) / 100);
  return c;
}

// Gün sonu: kredi taksitleri ve temettü. Günün kaydını (rec) günceller.
export function dailyFinance(S, rec) {
  let interest = 0, principal = 0;
  for (const l of S.loans || []) {
    const int = l.principal * l.rate / 365;
    let pay = Math.min(l.pay, l.principal + int);
    l.left--;
    if (l.left <= 0) pay = l.principal + int;
    interest += int; principal += pay - int;
    l.principal -= pay - int;
  }
  S.loans = (S.loans || []).filter(l => l.principal > 1 && l.left > 0);
  const div = (S.float || 0) * DIVIDEND * Math.max(0, rec.profit - interest);
  S.cash -= interest + principal + div;
  rec.cost += interest + div; rec.profit -= interest + div;
  rec.interest = interest; rec.principal = principal; rec.div = div;
  return rec;
}
