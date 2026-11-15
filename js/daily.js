// Günün görevi: her gün herkese aynı başlangıç (üs, mevsim, koşullar) ve aynı olaylar.
// 60 günün sonunda şirket değerin puanındır. Ayrı kayıtta tutulur, asıl oyunu etkilemez.
import { AIRPORTS } from './data.js';
import * as sim from './sim.js';
import * as D from './depth.js';
import { spawnRivals } from './rivals.js';
import { companyValue } from './progress.js';
import { newState, rng32, withSeed } from './game.js';

export const DAILY_DAYS = 60;
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dateLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const MODS = [
  { id: 'fuel', text: 'Yakıt %25 pahalı', apply: S => S.events.push({ id: -2, kind: 'fuel', title: 'Pahalı yakıt', text: 'Günün koşulu: yakıt %25 pahalı.', global: true, fuel: 1.25, from: 0, until: 999 }) },
  { id: 'poor', text: 'Kasada yalnızca 9 M$ var', apply: S => { S.cash = 9e6; } },
  { id: 'rich', text: 'Yatırımcı desteği: kasada 24 M$ var', apply: S => { S.cash = 24e6; } },
  { id: 'tour', text: 'Turizm patlaması: turistik yerlere talep +%30', apply: S => S.events.push({ id: -3, kind: 'tourism', title: 'Turizm patlaması', text: 'Günün koşulu: turistik yerlere talep +%30.', tourist: true, dem: 1.3, from: 0, until: 999 }) },
  { id: 'rival', text: 'Rakipler çok saldırgan ve zengin', apply: S => { for (const rv of S.rivals) { rv.aggr = 1; rv.cash *= 2.5; } } },
  { id: 'cheapjet', text: 'Kiralama piyasası durgun: ikinci el uçaklar bol ve ucuz', apply: S => { for (const u of S.used || []) { u.price = Math.round(u.price * 0.7); u.leaseDay = Math.round(u.leaseDay * 0.75); } } },
  { id: 'rep', text: 'Kötü başlangıç: itibarın −%10', apply: S => { S.rep = 0.9; } },
  { id: 'fast', text: 'Açılış kampanyası hediye: yeni hatlar daha hızlı dolar', apply: S => { S.upgrades.launch = 2; } },
];

// Bugünün görevi (tarih aynıysa herkes için aynı)
export function dailyDef(key = todayKey()) {
  const r = rng32(hash('skyweave-daily-' + key));
  const pick = arr => arr[Math.floor(r() * arr.length)];
  const bases = AIRPORTS.filter(a => a.z === 'TR' && a.p >= 0.6).sort((x, y) => x.c < y.c ? -1 : 1);
  const base = pick(bases).c;
  const month = Math.floor(r() * 12);
  const mods = [];
  const n = r() < 0.5 ? 1 : 2;
  while (mods.length < n) { const m = pick(MODS); if (!mods.includes(m) && !(m.id === 'rich' && mods.some(x => x.id === 'poor')) && !(m.id === 'poor' && mods.some(x => x.id === 'rich'))) mods.push(m); }
  return { key, seed: hash('skyweave-run-' + key), base, month, mods };
}

// Ayrılma eki: İstanbul'dan, İzmir'den, Kars'tan, Muş'tan
function from(name) {
  const w = name.split(' ').pop();
  const vowels = [...w.toLocaleLowerCase('tr-TR')].filter(ch => 'aıoueiöü'.includes(ch));
  const back = 'aıou'.includes(vowels[vowels.length - 1] || 'a');
  const hard = 'çfhkpsştÇFHKPSŞT'.includes(w[w.length - 1]);
  return `${name}'${hard ? 't' : 'd'}${back ? 'a' : 'e'}n`;
}
export function describeDaily(def) {
  return `${from(sim.AP[def.base].n)} başla, takvim: 1 ${MONTHS[def.month]}. ${def.mods.map(m => m.text).join('. ')}. ${DAILY_DAYS} günün sonunda şirket değerin puanın olur.`;
}

export function newDaily(name, def = dailyDef()) {
  const S = newState(name, def.base);
  S.daily = { key: def.key, days: DAILY_DAYS, mods: def.mods.map(m => m.id), done: false };
  S.rngState = def.seed;
  // Başlangıç: seçilen ayın ilk günü
  const start = new Date(sim.START), target = Date.UTC(start.getUTCFullYear() + (def.month < 3 ? 1 : 0), def.month, 1, 6);
  S.t = Math.round((target - sim.START) / 3600e3);
  withSeed(S, () => { spawnRivals(S); D.refreshUsed(S); });
  for (const id of S.daily.mods) MODS.find(m => m.id === id).apply(S);
  return S;
}

export const dailyScore = S => Math.round(companyValue(S));
export function checkDaily(S) {
  if (!S.daily || S.daily.done || S.day < S.daily.days) return null;
  S.daily.done = true;
  S.daily.score = dailyScore(S);
  return { score: S.daily.score };
}
