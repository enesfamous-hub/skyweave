// Otomatik testler. Çalıştır: node tests/run.mjs
// Bot oyuncuyla birkaç oyun oynatır ve denge sınırlarını, tutarlılığı denetler.
import { runGame, seedRandom } from './bot.mjs';
import * as sim from '../js/sim.js';
import * as X from '../js/extra.js';
import { newState, addRoute, advanceDay } from '../js/game.js';

let fail = 0, pass = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + msg); } };
const section = t => console.log('\n• ' + t);

section('Ekonomi birimleri');
ok(sim.baseFare(1000) === 110, 'baseFare(1000) = 110');
ok(sim.baseFare(9000) === 535, 'uzun hat ücreti azalır: baseFare(9000) = 535');
ok(sim.orgPerPlane(10) === 700 && sim.orgPerPlane(100) === 4300, 'uçak başına yönetim gideri');
{
  const S = newState('T', 'IST');
  ok(sim.baseCost(S) === 1.5e6, 'ikinci üs 1,5 M$');
  S.bases.push('ESB', 'ADB');
  ok(sim.baseCost(S) > 4e6, 'dördüncü üs daha pahalı');
}

section('Tek uçaklık ilk hat kârlı olabilir (oyun başı adil mi)');
{
  seedRandom(7);
  const S = newState('T', 'IST');
  S.fleet.push({ id: 'F1', type: 'atr72', leased: true, reg: 'X', route: null, age: 0, cond: 100 });
  const r = addRoute(S, sim.AP.IST, sim.AP.ESB, ['F1']);
  const e = sim.routeEcon(r, S.fleet, 120, true, S);
  ok(e.net > 0, `IST–ESB ATR olgun hat günlük net > 0 (${Math.round(e.net)})`);
  ok(e.net < 20000, `ATR tek başına günde 20 bin $'dan az kazanır (${Math.round(e.net)})`);
  ok(e.cargo > 0 && e.cargo <= e.cargoCap, 'kargo kapasiteyi aşmaz');
  for (let i = 0; i < 30; i++) { S.t = 9 + 24 * S.day; advanceDay(S); }
  ok(isFinite(S.cash) && S.history.length === 30, '30 gün sorunsuz ilerler');
  ok(S.totalCargo > 0, 'kargo birikir');
}

section('Bot ile 3 oyun × 365 gün');
const results = [];
for (const [seed, base] of [[11, 'IST'], [12, 'ESB'], [13, 'AYT']]) {
  const t0 = Date.now();
  const { S, log, tierDay } = runGame({ seed, days: 365, base });
  results.push({ seed, S, log, tierDay });
  const nan = log.some(l => !isFinite(l.cash) || !isFinite(l.profit));
  ok(!nan, `tohum ${seed}: NaN/sonsuz değer yok`);
  ok(!S.over, `tohum ${seed}: iflas yok`);
  ok(tierDay[2] != null && tierDay[2] >= 5 && tierDay[2] <= 60, `tohum ${seed}: Ulusal lisans 5–60. gün arası (${tierDay[2]})`);
  ok(tierDay[3] == null || tierDay[3] >= 80, `tohum ${seed}: Kıtasal lisans 80. günden önce değil (${tierDay[3]})`);
  ok(tierDay[4] == null || tierDay[4] >= 180, `tohum ${seed}: Uluslararası lisans 180. günden önce değil (${tierDay[4]})`);
  const p365 = log.slice(-7).reduce((s, l) => s + l.profit, 0) / 7;
  ok(p365 < 25e6, `tohum ${seed}: 1. yıl sonunda günlük kâr 25 M$'ın altında (${(p365 / 1e6).toFixed(1)}M)`);
  ok(S.fleet.length < 220, `tohum ${seed}: 1. yılda filo 220'nin altında (${S.fleet.length})`);
  const deals = S.contractLog || [];
  ok(deals.length >= 5, `tohum ${seed}: sözleşmeler geliyor (${deals.length})`);
  ok(deals.some(d => d.ok), `tohum ${seed}: en az bir sözleşme başarılı`);
  ok(Object.keys(S.badges).length >= 8, `tohum ${seed}: rozetler kazanılıyor (${Object.keys(S.badges).length})`);
  // Tutarlılık: rotadaki uçaklar filoda, uçağın rotası doğru
  const ids = new Set(S.fleet.map(f => f.id));
  ok(S.routes.every(r => r.planes.every(id => ids.has(id))), `tohum ${seed}: rotalardaki uçaklar filoda`);
  ok(S.fleet.every(f => !f.route || S.routes.some(r => r.id === f.route && r.planes.includes(f.id))), `tohum ${seed}: uçak–rota bağı tutarlı`);
  ok(S.routes.every(r => S.bases.includes(r.a) || S.bases.includes(r.b)), `tohum ${seed}: her hattın bir ucu üs`);
  // Kayıt JSON'a dönüşebilmeli
  const back = JSON.parse(JSON.stringify(S));
  ok(back.day === S.day && back.fleet.length === S.fleet.length, `tohum ${seed}: kayıt JSON gidiş-dönüş`);
  console.log(`  tohum ${seed} (${base}): ${Date.now() - t0} ms · lisans günleri ${JSON.stringify(tierDay)} · filo ${S.fleet.length} · kâr/gün ${(p365 / 1e6).toFixed(2)}M · sözleşme ${deals.filter(d => d.ok).length}/${deals.length}`);
}

section('Rakip satın alma');
{
  const { S } = results[0];
  const rv = S.rivals.find(r => r.active && !X.canAcquire(S, r)) || S.rivals.find(r => r.active);
  if (rv) {
    S.cash += X.acquireCost(S, rv) * 2;
    const why = X.canAcquire(S, rv);
    if (!why) {
      const before = S.routes.length, cash = S.cash;
      const res = X.acquireRival(S, rv);
      ok(res && !rv.active, 'rakip pazardan çıkar');
      ok(S.bases.includes(rv.hub), 'rakibin merkezi üs olur');
      ok(S.routes.length >= before, 'hatlar devralınır');
      ok(Math.abs(cash - res.cost - S.cash) < 1, 'fiyat kasadan düşer');
      ok(S.routes.every(r => r.planes.every(id => S.fleet.some(f => f.id === id))), 'devralınan uçaklar filoda');
    } else console.log('  (satın alınamadı: ' + why + ')');
  }
}

section('Sözleşmeler');
{
  seedRandom(5);
  const S = newState('T', 'IST');
  S.fleet.push({ id: 'F1', type: 'atr72', leased: true, reg: 'X', route: null, age: 0, cond: 100 });
  const r = addRoute(S, sim.AP.IST, sim.AP.ESB, ['F1']);
  for (let i = 0; i < 3; i++) { S.t = 9 + 24 * S.day; advanceDay(S); }
  const seats = X.routeSeats(S, r);
  S.offers = [{ id: 'K1', kind: 'seats', key: 'x', a: 'IST', b: 'ESB', need: Math.floor(seats) - 5, days: 5, reward: 1e5, penalty: 1e4, client: 'C', title: 't', text: '', expires: 99 }];
  X.acceptOffer(S, 'K1');
  const cash0 = S.cash;
  for (let i = 0; i < 7; i++) { S.t = 9 + 24 * S.day; advanceDay(S); }
  ok(!S.contracts.length && S.contractLog.at(-1).ok, 'karşılanan koltuk sözleşmesi tamamlanır');
  S.offers = [{ id: 'K2', kind: 'seats', key: 'y', a: 'IST', b: 'ESB', need: seats * 3, days: 10, reward: 1e5, penalty: 5e4, client: 'C', title: 't2', text: '', expires: 99 }];
  X.acceptOffer(S, 'K2');
  for (let i = 0; i < 8; i++) { S.t = 9 + 24 * S.day; advanceDay(S); }
  ok(!S.contracts.length && !S.contractLog.at(-1).ok, 'karşılanmayan sözleşme 3 aksamada iptal');
  ok(isFinite(cash0) && isFinite(S.cash), 'kasa sayısal kalır');
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
