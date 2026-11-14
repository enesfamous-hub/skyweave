// Rakip havayolları (hayali isimler) ve haftalık yapay zekâ kararları.
import { AIRPORTS } from './data.js';
import { AP, AC, distKm, demandPerDir, leasePerDay, pairKey, rivalsOnPair, rivalRouteSeats, rtPerDay, dayOfYear, gameDate, MIN_ROUTE_KM } from './sim.js';

// appear: oyuncu bu lisansa ulaşınca ya da bu güne gelince pazara girer.
export const RIVAL_DEFS = [
  { id: 'BOG', name: 'Boğaziçi Hava', color: '#e63946', hub: 'IST', zones: ['TR'], cash: 25e6, aggr: 0.7, rep: 1.05,
    starts: [['IST', 'ESB', 'atr72', 2], ['IST', 'ADB', 'atr72', 1]], appear: { day: 0 } },
  { id: 'EGE', name: 'Ege Kanatları', color: '#2a9d8f', hub: 'ADB', zones: ['TR'], cash: 15e6, aggr: 0.4, rep: 1.0,
    starts: [['ADB', 'AYT', 'atr72', 1], ['ADB', 'ESB', 'q400', 1]], appear: { day: 0 } },
  { id: 'ANK', name: 'Anka Air', color: '#7b2cbf', hub: 'ESB', zones: ['TR'], cash: 18e6, aggr: 0.55, rep: 0.95,
    starts: [['ESB', 'TZX', 'q400', 1], ['ESB', 'DIY', 'q400', 1]], appear: { day: 20 } },
  { id: 'EUL', name: 'EuroLink', color: '#1d4e89', hub: 'FRA', zones: ['TR', 'K'], cash: 150e6, aggr: 0.5, rep: 1.1,
    starts: [['FRA', 'IST', 'a20n', 2], ['FRA', 'AYT', 'a20n', 1], ['FRA', 'LHR', 'a20n', 1]], appear: { tier: 3, day: 220 } },
  { id: 'GLF', name: 'Gulf Star', color: '#b08900', hub: 'DXB', zones: ['TR', 'K', 'W'], cash: 400e6, aggr: 0.6, rep: 1.15,
    starts: [['DXB', 'IST', 'a21n', 2], ['DXB', 'LHR', 'b789', 1], ['DXB', 'BOM', 'a21n', 1]], appear: { tier: 3, day: 280 } },
  { id: 'ATL', name: 'Atlantic Wings', color: '#118ab2', hub: 'JFK', zones: ['K', 'W'], cash: 500e6, aggr: 0.5, rep: 1.1,
    starts: [['JFK', 'LHR', 'b789', 2], ['JFK', 'IST', 'b789', 1]], appear: { tier: 4, day: 450 } },
  { id: 'ORP', name: 'Orient Pacific', color: '#e76f51', hub: 'SIN', zones: ['W'], cash: 450e6, aggr: 0.5, rep: 1.1,
    starts: [['SIN', 'HND', 'a359', 1], ['SIN', 'SYD', 'a359', 1], ['SIN', 'BKK', 'a20n', 1]], appear: { tier: 4, day: 520 } },
];

function makeRival(def) {
  return {
    id: def.id, name: def.name, color: def.color, hub: def.hub, zones: def.zones,
    cash: def.cash, aggr: def.aggr, rep: def.rep, active: true, lastPax: 0, lastProfit: 0,
    routes: def.starts.map(([a, b, type, n]) => ({ a, b, type, n, fareMul: 1, age: 30 })),
  };
}

// Oyun başında ve gün sonlarında: zamanı gelen rakipleri pazara sok.
export function spawnRivals(S) {
  const news = [];
  S.rivals = S.rivals || [];
  for (const def of RIVAL_DEFS) {
    if (S.rivals.some(r => r.id === def.id)) continue;
    const ok = (def.appear.tier && S.tier >= def.appear.tier) || S.day >= def.appear.day;
    if (!ok) continue;
    S.rivals.push(makeRival(def));
    if (S.day > 0) news.push({ text: `Yeni rakip: ${def.name} (${AP[def.hub].n} merkezli) pazara girdi.`, color: def.color, important: true });
  }
  return news;
}

// Mesafe ve talebe göre uçak tipi
function typeFor(rv, d, demand, day) {
  const intl = rv.zones.includes('K') || rv.zones.includes('W');
  const jets = intl || day >= 60;
  let opts;
  if (d < 900 && (demand < 700 || !jets)) opts = ['atr72', 'q400'];
  else if (jets && d <= 6000) opts = demand > 900 ? ['a21n', 'a20n', 'b38m'] : ['a20n', 'b38m', 'e195'];
  else if (jets) opts = ['b789', 'a359'];
  else opts = ['q400'];
  return opts.find(t => AC[t].range >= d * 1.05) || null;
}

const zoneOk = (rv, ap) => rv.zones.includes(ap.z);

// Haftalık kararlar: fiyat, kapasite, çekilme, yeni hat, iflas. Haber listesi döner.
export function weeklyRivals(S) {
  const news = [];
  const doy = dayOfYear(gameDate(S.t));
  const playerPairs = new Map(S.routes.map(r => [pairKey(r.a, r.b), r]));
  for (const rv of S.rivals || []) {
    if (!rv.active) continue;

    for (const rr of [...rv.routes]) {
      const L = rr.last;
      if (!L) continue;
      const pr = playerPairs.get(pairKey(rr.a, rr.b));
      const pair = `${AP[rr.a].n}–${AP[rr.b].n}`;
      // Fiyat savaşı: oyuncu daha ucuzsa ve koltuklar boş kalıyorsa fiyat kır
      if (pr && pr.fareMul < rr.fareMul - 0.04 && L.load < 0.85 && Math.random() < rv.aggr) {
        rr.fareMul = Math.max(0.7, Math.round((pr.fareMul - 0.05) * 20) / 20);
        news.push({ text: `${rv.name}, ${pair} hattında bilet fiyatını %${Math.round(rr.fareMul * 100)}'e indirdi.`, color: rv.color, important: true });
      } else if (L.load < 0.6 && rr.fareMul > 0.75) rr.fareMul = Math.round((rr.fareMul - 0.05) * 20) / 20;
      else if (L.load > 0.95 && rr.fareMul < 1.35) rr.fareMul = Math.round((rr.fareMul + 0.05) * 20) / 20;

      // Kapasite artır
      const dep = leasePerDay(AC[rr.type]) * 30;
      // (hat başına uçak sayısı yaşla birlikte yavaşça artabilir)
      const cap = 1 + Math.floor((rr.age || 0) / 45);
      if (L.load > 0.93 && L.profit > 0 && rv.cash > dep * 4 && rr.n < cap && Math.random() < 0.5) {
        rr.n++; rv.cash -= dep;
        if (pr) news.push({ text: `${rv.name}, ${pair} hattına uçak ekledi (${rr.n} uçak).`, color: rv.color, important: false });
      }

      // Zarar eden hattan çekil
      if (L.profit < 0 && rr.age > 28) {
        rr.bad = (rr.bad || 0) + 1;
        if (rr.bad >= 2) {
          rr.bad = 0;
          if (rr.n > 1) rr.n--;
          else {
            rv.routes.splice(rv.routes.indexOf(rr), 1);
            news.push({ text: `${rv.name}, ${pair} hattından çekildi.`, color: rv.color, important: !!pr });
          }
        }
      } else rr.bad = 0;
    }

    // Yeni hat aç
    const maxRoutes = Math.min(rv.zones.includes('W') ? 26 : 16, 3 + Math.floor(S.day / 18));
    const minCash = rv.zones.length > 1 ? 20e6 : 4e6;
    if (rv.routes.length < maxRoutes && rv.cash > minCash && Math.random() < 0.65) {
      const hub = AP[rv.hub];
      const cands = [];
      for (const ap of AIRPORTS) {
        if (ap === hub || !zoneOk(rv, ap)) continue;
        const d = distKm(hub, ap);
        if (d < MIN_ROUTE_KM) continue;
        if (rv.routes.some(r => pairKey(r.a, r.b) === pairKey(hub.c, ap.c))) continue;
        const D0 = demandPerDir(hub, ap, doy, 1);
        const type = typeFor(rv, d, D0, S.day);
        if (!type) continue;
        let existing = rivalsOnPair(S, hub.c, ap.c).reduce((s, x) => s + rivalRouteSeats(x.rr), 0);
        const pr = playerPairs.get(pairKey(hub.c, ap.c));
        if (pr) existing += pr.planes.length * 300;
        let score = D0 - existing * 0.8;
        if (pr) score *= 1 + rv.aggr * 0.4; // oyuncunun kârlı hatlarına saldır
        if (score > 150) cands.push({ ap, type, score });
      }
      cands.sort((x, y) => y.score - x.score);
      const pick = cands[Math.floor(Math.random() * Math.min(3, cands.length))];
      if (pick) {
        const dep = leasePerDay(AC[pick.type]) * 30;
        rv.cash -= dep;
        rv.routes.push({ a: hub.c, b: pick.ap.c, type: pick.type, n: 1, fareMul: 1, age: 0 });
        const vsPlayer = playerPairs.has(pairKey(hub.c, pick.ap.c));
        news.push({
          text: vsPlayer ? `${rv.name}, senin ${hub.n}–${pick.ap.n} hattına rakip olarak girdi!` : `${rv.name}, ${hub.n}–${pick.ap.n} hattını açtı.`,
          color: rv.color, important: vsPlayer,
        });
      }
    }

    // İflas
    if (rv.cash < -20e6) {
      rv.active = false;
      rv.routes = [];
      news.push({ text: `${rv.name} iflas etti! Hatları boşaldı.`, color: rv.color, important: true });
    }
  }
  return news;
}

// Bir havalimanında rakiplerin günlük sefer sayısı (3B trafik renkleri için)
export function rivalFlightsAt(S, code) {
  const out = [];
  for (const rv of S.rivals || []) {
    if (!rv.active) continue;
    let f = 0;
    for (const rr of rv.routes) {
      if (rr.a !== code && rr.b !== code) continue;
      const d = distKm(AP[rr.a], AP[rr.b]);
      f += 2 * rr.n * rtPerDay(d, AC[rr.type]);
    }
    if (f > 0) out.push({ color: rv.color, flights: f, name: rv.name });
  }
  return out;
}
