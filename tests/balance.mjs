// Denge raporu: birkaç farklı tohum ve üsle oyunu oynatıp özet basar.
// Çalıştır: node tests/balance.mjs [gün] [tohum sayısı]
import { runGame } from './bot.mjs';

const days = +(process.argv[2] || 720), seeds = +(process.argv[3] || 4);
const M = n => (n / 1e6).toFixed(1).padStart(7) + 'M';
const bases = ['IST', 'ESB', 'ADB', 'AYT'];
for (let s = 1; s <= seeds; s++) {
  const base = bases[(s - 1) % bases.length];
  const t0 = Date.now();
  const { S, log, tierDay } = runGame({ seed: s, days, base });
  console.log(`\n== tohum ${s} · üs ${base} · ${Date.now() - t0} ms ${S.over ? '· İFLAS gün ' + S.day : ''}`);
  console.log('lisans günleri:', JSON.stringify(tierDay));
  for (const L of log.filter(l => l.day % 60 === 0 || l.day === 7 || l.day === 30)) {
    const wk = log.slice(Math.max(0, L.day - 7), L.day);
    const avg = wk.reduce((a, b) => a + b.profit, 0) / wk.length;
    console.log(`gün ${String(L.day).padStart(4)} T${L.tier} kasa ${M(L.cash)} kâr/gün ${M(avg)} değer ${M(L.value)} filo ${String(L.fleet).padStart(3)} hat ${String(L.routes).padStart(3)}`);
  }
  console.log(`yükseltme: ${JSON.stringify(S.upgrades)} · görev: ${S.goalsDone.length} · üs: ${S.bases.join(',')}`);
  const cl = S.contractLog || [], by = {};
  for (const c of cl) { by[c.kind] = by[c.kind] || [0, 0]; by[c.kind][c.ok ? 0 : 1]++; }
  console.log('rozet:', Object.keys(S.badges || {}).length, '· sözleşme (başarılı/başarısız, son 40):', JSON.stringify(by), '· satın alınan rakip:', (S.acquired || []).join(',') || '-');
}
