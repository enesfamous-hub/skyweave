// Oyunun arayüzden bağımsız çekirdeği: yeni oyun, hat açma ve gün sonu akışı.
// Hem main.js hem de Node testleri (tests/) bunu kullanır.
import * as sim from './sim.js';
import { spawnRivals, weeklyRivals } from './rivals.js';
import { dailyEvents } from './events.js';
import * as P from './progress.js';
import * as D from './depth.js';
import * as X from './extra.js';

export const ROUTE_COLORS = ['#ffd166', '#06d6a0', '#4cc9f0', '#ef476f', '#f8961e', '#c77dff', '#90be6d', '#ff99c8', '#a0c4ff', '#fdffb6', '#9bf6ff', '#ffadad'];
// Gün sonu 00:00 TSİ'de (oyun t=0 → 09:00 TSİ)
export const DAY_OFFSET = 15;

const money = n => {
  const s = n < 0 ? '−' : ''; n = Math.abs(n);
  if (n >= 1e9) return `${s}$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${s}$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${s}$${Math.round(n / 1e3)}K`;
  return `${s}$${Math.round(n)}`;
};
const num = n => Math.round(n).toLocaleString('tr-TR');

export function newState(name, base, legacy = null) {
  return { v: 2, name, t: 0, day: 0, cash: 15e6, tier: 1, bases: [base], fleet: [], routes: [], totalPax: 0, history: [], seq: 1, regSeq: 0, over: false, rivals: [], news: [], events: [], newsSeen: 0,
    upgrades: {}, managers: {}, goalsDone: [], goalsNotified: [], legacy, lastSeen: Date.now(), cashBonus: 0,
    service: 1, slots: {}, loans: [], float: 0, checks: 0, used: null,
    contracts: [], offers: [], badges: {}, totalCargo: 0 };
}

export function nextReg(S) {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', i = S.regSeq++;
  return `TC-S${L[Math.floor(i / 26) % 26]}${L[i % 26]}`;
}

export function addRoute(S, a, b, planeIds, fareMul = 1) {
  const used = new Set(S.routes.map(r => r.color));
  const color = ROUTE_COLORS.find(c => !used.has(c)) || ROUTE_COLORS[S.routes.length % ROUTE_COLORS.length];
  const r = { id: 'R' + S.seq++, a: a.c, b: b.c, fareMul, planes: planeIds, color, age: 0, last: null };
  planeIds.forEach(id => { const f = S.fleet.find(x => x.id === id); if (f) f.route = r.id; });
  S.routes.push(r);
  return r;
}

// Günlük istatistik: kasa, pazar payı ve hat geçmişi
export function recordStats(S, rec) {
  rec.cash = Math.round(S.cash);
  const rivalPax = (S.rivals || []).filter(rv => rv.active).reduce((s, rv) => s + (rv.lastPax || 0), 0);
  rec.mshare = rec.pax + rivalPax ? rec.pax / (rec.pax + rivalPax) : 1;
  rec.routes = S.routes.length; rec.fleet = S.fleet.length;
  for (const r of S.routes) {
    if (!r.last) continue;
    r.hist = r.hist || [];
    r.hist.push({ d: S.day, net: Math.round(r.last.net), load: +r.last.load.toFixed(3), share: r.last.share == null ? null : +r.last.share.toFixed(3), pax: r.last.pax });
    if (r.hist.length > 60) r.hist.shift();
  }
}

// Tüm zamanların rekorları (geçmiş 400 günle sınırlı olduğu için ayrı tutulur)
export function checkRecords(S, rec) {
  const fresh = !S.records;
  const R = S.records = S.records || {};
  const out = [];
  const beat = (key, val, label, minDay = 3) => {
    const old = R[key];
    if (!old || val > old.v) {
      R[key] = { v: val, day: S.day };
      if (old && S.day > minDay && old.v > 0) out.push(label);
    }
  };
  beat('profit', rec.profit, `Rekor: en kârlı gün (${money(rec.profit)})`);
  beat('pax', rec.pax, `Rekor: bir günde ${num(rec.pax)} yolcu`);
  if (!R.worst || rec.profit < R.worst.v) R.worst = { v: rec.profit, day: S.day };
  if (!R.cash || S.cash > R.cash.v) R.cash = { v: S.cash, day: S.day };
  const MS = [1e4, 1e5, 5e5, 1e6, 5e6, 1e7, 5e7, 1e8];
  const ms = MS.filter(m => S.totalPax >= m).pop();
  if (ms && (R.paxMs || 0) < ms) { if (!fresh) out.push(`${num(ms)}. yolcu taşındı!`); R.paxMs = ms; }
  return out;
}

// Bir günü kapatır. Arayüz bunu çağırır, sonra haberleri ve rekorları gösterir.
export function advanceDay(S) {
  const rec = sim.settleDay(S);
  D.dailyFinance(S, rec);
  recordStats(S, rec);
  const news = spawnRivals(S);
  if (S.day % 7 === 0) news.push(...weeklyRivals(S));
  news.push(...dailyEvents(S));
  news.push(...D.dailyFleet(S));
  news.push(...P.runManagers(S, (a, b, ids) => addRoute(S, a, b, ids), D.runTech));
  news.push(...X.dailyContracts(S));
  const recs = checkRecords(S, rec);
  const badges = X.checkBadges(S);
  return { rec, news, recs, badges };
}
