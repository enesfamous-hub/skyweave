// Olaylar ve haberler: hava, bayramlar, festivaller, yakıt, ekonomi, grev, teknik inceleme
// ve oyuncunun karar vereceği olaylar.
import { AIRPORTS } from './data.js';
import { AP, AC, gameDate, activeEvents } from './sim.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const money = n => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;

// Türkçe bulunma eki: İstanbul'da, İzmir'de, Ankara'da, Paris'te
export function loc(name) {
  const w = name.split(' ').pop();
  const vowels = [...w.toLowerCase()].filter(ch => 'aıoueiöü'.includes(ch));
  const last = vowels[vowels.length - 1] || 'a';
  const back = 'aıou'.includes(last);
  const hard = 'çfhkpsştÇFHKPSŞT'.includes(w[w.length - 1]);
  return `${name}'${hard ? 't' : 'd'}${back ? 'a' : 'e'}`;
}

// ---------- Yıllık takvim olayları (yaklaşık tarihler) ----------
const BAYRAM = {
  2027: [['03-09', 'Ramazan Bayramı'], ['05-16', 'Kurban Bayramı']],
  2028: [['02-26', 'Ramazan Bayramı'], ['05-04', 'Kurban Bayramı']],
  2029: [['02-14', 'Ramazan Bayramı'], ['04-23', 'Kurban Bayramı']],
  2030: [['02-04', 'Ramazan Bayramı'], ['04-13', 'Kurban Bayramı']],
};
const ANNUAL = [
  { md: '12-27', days: 7, title: 'Yılbaşı tatili', text: 'Yılbaşı tatili başladı: tüm dünyada uçuş talebi arttı.', global: true, dem: 1.15 },
  { md: '09-01', days: 10, title: 'İzmir Enternasyonal Fuarı', text: "İzmir Enternasyonal Fuarı başladı: İzmir'e talep arttı.", airports: ['ADB'], dem: 1.4 },
  { md: '10-03', days: 7, title: 'Antalya Film Festivali', text: "Antalya Film Festivali: Antalya'ya talep arttı.", airports: ['AYT'], dem: 1.3 },
  { md: '07-10', days: 14, title: 'Kapadokya balon sezonu', text: "Kapadokya'da balon sezonu zirvede: Nevşehir ve Kayseri'ye talep arttı.", airports: ['NAV', 'ASR'], dem: 1.35 },
  { md: '09-19', days: 16, title: 'Oktoberfest', text: "Münih'te Oktoberfest başladı: Münih'e talep arttı.", airports: ['MUC'], dem: 1.45 },
  { md: '01-10', days: 20, title: 'Dubai Alışveriş Festivali', text: "Dubai Alışveriş Festivali: Dubai'ye talep arttı.", airports: ['DXB'], dem: 1.3 },
  { md: '06-15', days: 30, title: 'Okullar tatile girdi', text: 'Türkiye\'de okullar tatile girdi: tatil bölgelerine talep arttı.', tourist: true, dem: 1.15 },
];

function dateKey(date) { return `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`; }

// ---------- Hava olayları ----------
const SNOW = ['ERZ', 'KSY', 'VAN', 'ASR', 'SZF', 'TZX', 'ESB', 'MLX', 'EZS', 'KYA', 'SVO', 'WAW', 'BER', 'ORD', 'YYZ', 'ICN', 'PEK', 'IST', 'SAW'];
const FOG = ['IST', 'SAW', 'ESB', 'ADA', 'BAL', 'DIY', 'LHR', 'AMS', 'FRA', 'MXP', 'DEL'];
const SAND = ['DXB', 'DOH', 'RUH', 'KWI', 'CAI'];
const TYPHOON = ['HKG', 'HND', 'PVG', 'ICN'];
const HURRICANE = ['MIA'];

function weatherFor(month) {
  const opts = [];
  if ([12, 1, 2].includes(month)) opts.push(['snow', 4], ['fog', 3]);
  else if ([3, 11].includes(month)) opts.push(['fog', 3], ['storm', 2], ['snow', 1]);
  else opts.push(['storm', 4]);
  if ([6, 7, 8].includes(month)) opts.push(['sand', 1]);
  if ([7, 8, 9, 10].includes(month)) opts.push(['typhoon', 1]);
  if ([8, 9, 10].includes(month)) opts.push(['hurricane', 1]);
  const total = opts.reduce((s, o) => s + o[1], 0);
  let r = Math.random() * total;
  for (const [k, w] of opts) { r -= w; if (r < 0) return k; }
  return 'storm';
}

const WEATHER = {
  snow: { pool: SNOW, cap: 0.4, dem: 0.85, days: [1, 3], title: 'Kar fırtınası', label: 'Kar', text: (n, d) => `${loc(n)} yoğun kar yağışı: seferlerin yarısından fazlası iptal (${d} gün).` },
  fog: { pool: FOG, cap: 0.6, dem: 1, days: [1, 1], title: 'Yoğun sis', label: 'Sis', text: n => `${loc(n)} yoğun sis: kapasite %60'a düştü (1 gün).` },
  storm: { pool: null, cap: 0.55, dem: 0.95, days: [1, 1], title: 'Fırtına', label: 'Fırtına', text: n => `${loc(n)} şiddetli fırtına: seferlerin yaklaşık yarısı ertelendi.` },
  sand: { pool: SAND, cap: 0.6, dem: 1, days: [1, 2], title: 'Kum fırtınası', label: 'Kum fırtınası', text: (n, d) => `${loc(n)} kum fırtınası: görüş düştü, kapasite %60 (${d} gün).` },
  typhoon: { pool: TYPHOON, cap: 0.15, dem: 0.7, days: [2, 3], title: 'Tayfun', label: 'Tayfun', text: (n, d) => `${n} tayfun uyarısı: havalimanı neredeyse kapalı (${d} gün).` },
  hurricane: { pool: HURRICANE, cap: 0.1, dem: 0.6, days: [2, 4], title: 'Kasırga', label: 'Kasırga', text: (n, d) => `${n} kasırga uyarısı: uçuşlar büyük ölçüde iptal (${d} gün).` },
};

// Etkilenecek havalimanı: çoğunlukla oyuncunun ağından (oyunu etkilesin), bazen başka yerden
function pickAirport(S, pool) {
  const net = new Set();
  S.routes.forEach(r => { net.add(r.a); net.add(r.b); });
  const eligible = (pool ? pool.map(c => AP[c]) : AIRPORTS).filter(Boolean);
  const mine = eligible.filter(a => net.has(a.c));
  if (mine.length && Math.random() < 0.65) return pick(mine);
  return pick(eligible);
}

// ---------- Kararlar ----------
const DECISIONS = {
  wage: {
    title: 'Sendika zam istiyor',
    text: 'Kabin ve kokpit ekiplerin %8 zam istiyor. Reddedersen grev riski var.',
    options: [
      { label: 'Zammı ver', desc: () => 'Ekip maliyetin kalıcı olarak %8 artar.',
        apply: S => { S.wageMul = (S.wageMul || 1) * 1.08; return 'Ekibine %8 zam verdin. Ekip memnun.'; } },
      { label: 'Reddet', desc: () => '%50 ihtimalle 2 günlük grev: tüm seferlerin iptal olur.',
        apply: S => {
          if (Math.random() < 0.5) {
            addEvent(S, { kind: 'strike', strike: true, title: 'Ekip grevi', label: 'Grev', days: 2, text: 'Ekibin greve çıktı! 2 gün boyunca tüm seferlerin iptal.', important: true, mine: true });
            return 'Zam reddedildi, ekip greve çıktı.';
          }
          S.rep = (S.rep || 1) * 0.97;
          return 'Zam reddedildi. Grev olmadı ama moral düştü (itibar −%3).';
        } },
    ],
  },
  ads: {
    title: 'Reklam kampanyası',
    text: 'Bir ajans 30 günlük TV ve sosyal medya kampanyası öneriyor. Rakiplere karşı yolcu payını artırır.',
    cost: S => 300e3 + 80e3 * S.fleet.length,
    options: [
      { label: 'Kampanyayı yap', desc: S => `${money(DECISIONS.ads.cost(S))} öde, 30 gün boyunca itibarın +%12.`, needsCash: true,
        apply: S => { S.cash -= DECISIONS.ads.cost(S); addEvent(S, { kind: 'ads', rep: 1.12, title: 'Reklam kampanyası', days: 30, text: 'Reklam kampanyan yayında: 30 gün boyunca itibarın yüksek.', mine: true }); return 'Reklam kampanyası başladı.'; } },
      { label: 'Gerek yok', desc: () => 'Hiçbir şey değişmez.', apply: () => 'Reklam teklifini geri çevirdin.' },
    ],
  },
  maint: {
    title: 'Ucuz bakım teklifi',
    text: 'Yeni bir bakım firması genel giderlerini %20 düşürmeyi teklif ediyor. Ama kalitesi tartışmalı.',
    options: [
      { label: 'Anlaşmayı imzala', desc: () => 'Genel gider −%20. Ara sıra bir uçak tipin teknik incelemeye girip birkaç gün yerde kalabilir.',
        apply: S => { S.overheadMul = 0.8; S.cheapMaint = true; return 'Ucuz bakım anlaşması imzalandı.'; } },
      { label: 'Mevcut firmayla devam', desc: () => 'Hiçbir şey değişmez.', apply: () => 'Bakım teklifini geri çevirdin.' },
    ],
  },
  hedge: {
    title: 'Yakıt fiyat sabitleme',
    text: 'Bir banka, önümüzdeki 60 gün için yakıtı normal fiyattan sabitlemeyi öneriyor. Fiyatlar artarsa korunursun.',
    cost: S => 200e3 + 40e3 * S.fleet.length,
    options: [
      { label: 'Fiyatı sabitle', desc: S => `${money(DECISIONS.hedge.cost(S))} öde, 60 gün yakıt fiyat artışlarından etkilenmezsin.`, needsCash: true,
        apply: S => { S.cash -= DECISIONS.hedge.cost(S); S.hedgeUntil = S.day + 60; return 'Yakıt fiyatın 60 günlüğüne sabitlendi.'; } },
      { label: 'Piyasa fiyatından devam', desc: () => 'Yakıt fiyatı ne olursa onu ödersin.', apply: () => 'Yakıt sabitleme teklifini geri çevirdin.' },
    ],
  },
};

export function decisionView(S) {
  const d = S.pendingDecision && DECISIONS[S.pendingDecision.id];
  if (!d) return null;
  return {
    title: d.title, text: d.text,
    options: d.options.map(o => ({ label: o.label, desc: o.desc(S), disabled: !!(o.needsCash && S.cash < d.cost(S)) })),
  };
}

export function decide(S, i) {
  const d = DECISIONS[S.pendingDecision.id];
  S.pendingDecision = null;
  S.lastDecisionDay = S.day;
  S._newNews = [];
  const text = d.options[i].apply(S);
  const extra = S._newNews;
  delete S._newNews;
  return [{ text, color: '#ffd166', kind: 'decision', important: true }, ...extra];
}

// ---------- Olay ekleme ----------
function addEvent(S, ev) {
  S.events = S.events || [];
  S.evSeq = (S.evSeq || 0) + 1;
  const e = { id: S.evSeq, from: S.day, until: S.day + (ev.days || 1), ...ev };
  delete e.days;
  S.events.push(e);
  S._newNews = S._newNews || [];
  S._newNews.push({ text: e.text, color: e.color || eventColor(e), kind: 'event', important: e.important ?? true });
  return e;
}

function eventColor(e) {
  if (e.mine) return '#ffd166';
  if ((e.dem ?? 1) > 1 || (e.fuel ?? 1) < 1) return '#06d6a0';
  return '#ef476f';
}

// Etki özeti (arayüz için)
export function describeEvent(e) {
  const parts = [];
  if (e.cap != null && e.cap < 1) parts.push(`kapasite %${Math.round(e.cap * 100)}`);
  if (e.dem != null && e.dem !== 1) parts.push(`talep ${e.dem > 1 ? '+' : '−'}%${Math.round(Math.abs(e.dem - 1) * 100)}`);
  if (e.fuel != null) parts.push(`yakıt ${e.fuel > 1 ? '+' : '−'}%${Math.round(Math.abs(e.fuel - 1) * 100)}`);
  if (e.rep != null) parts.push(`itibar ${e.rep > 1 ? '+' : '−'}%${Math.round(Math.abs(e.rep - 1) * 100)}`);
  if (e.grounded) parts.push(`${AC[e.grounded].name} uçakları yerde`);
  if (e.strike) parts.push('tüm seferlerin iptal');
  const where = e.airports ? e.airports.map(c => AP[c].n).join(', ') : e.country === 'TR' ? 'Türkiye' : e.tourist ? 'turistik yerler' : e.global ? 'tüm dünya' : '';
  return { effect: parts.join(' · '), where };
}

// ---------- Günlük olay üretimi ----------
// Yeni haberleri döner. S.events içinde süren olaylar tutulur.
export function dailyEvents(S) {
  S.events = (S.events || []).filter(e => e.until > S.day - 30); // eski olayları temizle
  S._newNews = [];
  const date = gameDate(S.t), year = date.getUTCFullYear(), md = dateKey(date), month = date.getUTCMonth() + 1;
  const active = activeEvents(S);
  const has = kind => active.some(e => e.kind === kind);

  // Bayramlar (3 gün önce başlar, 4 gün sürer) ve hac
  for (const [bmd, name] of BAYRAM[year] || []) {
    const start = new Date(Date.UTC(year, +bmd.slice(0, 2) - 1, +bmd.slice(3)) - 3 * 864e5);
    if (dateKey(start) === md) {
      addEvent(S, { kind: 'holiday', title: name, label: name, country: 'TR', dem: 1.35, days: 7, text: `${name} yaklaşıyor: Türkiye'de uçuş talebi %35 arttı (7 gün).` });
      if (name === 'Kurban Bayramı') addEvent(S, { kind: 'hajj', title: 'Hac dönemi', label: 'Hac', airports: ['JED'], dem: 1.8, days: 12, text: "Hac dönemi başladı: Cidde'ye talep çok yüksek (12 gün)." });
    }
  }
  for (const a of ANNUAL) if (a.md === md) addEvent(S, { kind: 'annual', label: a.title, ...a, days: a.days });

  // Hava olayları
  const pWeather = [12, 1, 2].includes(month) ? 0.16 : 0.08;
  if (Math.random() < pWeather) {
    const kind = weatherFor(month), W = WEATHER[kind];
    const ap = pickAirport(S, W.pool);
    if (!active.some(e => e.airports && e.airports.includes(ap.c) && e.cap)) {
      const days = rint(W.days[0], W.days[1]);
      addEvent(S, { kind: 'weather', title: W.title, label: W.label, airports: [ap.c], cap: W.cap, dem: W.dem, days, text: W.text(ap.n, days), important: S.routes.some(r => r.a === ap.c || r.b === ap.c) });
    }
  }

  // Yakıt fiyatı
  if (!has('fuel') && Math.random() < 0.009) {
    const up = Math.random() < 0.6;
    const f = up ? rnd(1.15, 1.35) : rnd(0.8, 0.9);
    const days = rint(25, 45);
    addEvent(S, { kind: 'fuel', title: up ? 'Yakıt fiyatı yükseldi' : 'Yakıt fiyatı düştü', global: true, fuel: Math.round(f * 100) / 100, days,
      text: up ? `Petrol fiyatları tırmandı: jet yakıtı %${Math.round((f - 1) * 100)} pahalandı (${days} gün).` : `Petrol fiyatları geriledi: jet yakıtı %${Math.round((1 - f) * 100)} ucuzladı (${days} gün).` });
  }

  // Ekonomi ve turizm
  if (!has('economy') && Math.random() < 0.004) {
    addEvent(S, { kind: 'economy', title: 'Kur dalgalanması', label: 'Ekonomi', country: 'TR', dem: 0.88, days: 30, text: "Kur dalgalanması: Türkiye'de uçuş talebi %12 düştü (30 gün)." });
  }
  if (!has('tourism') && [3, 4, 5].includes(month) && Math.random() < 0.01) {
    addEvent(S, { kind: 'tourism', title: 'Turizm patlaması', tourist: true, dem: 1.2, days: 45, text: 'Rekor turizm sezonu bekleniyor: turistik yerlere talep %20 arttı (45 gün).' });
  }

  // Yer hizmetleri grevi (bir havalimanında)
  if (Math.random() < 0.01) {
    const ap = pickAirport(S, null);
    const days = rint(1, 2);
    addEvent(S, { kind: 'airportStrike', title: 'Yer hizmetleri grevi', label: 'Grev', airports: [ap.c], cap: 0.35, days, text: `${loc(ap.n)} yer hizmetleri grevi: kapasite %35'e düştü (${days} gün).`, important: S.routes.some(r => r.a === ap.c || r.b === ap.c) });
  }

  // Teknik inceleme (bir uçak tipi yerde kalır)
  const pGround = 0.006 + (S.cheapMaint ? 0.006 : 0);
  if (!has('grounding') && Math.random() < pGround) {
    const types = new Set([...S.fleet.map(f => f.type), ...(S.rivals || []).flatMap(rv => rv.active ? rv.routes.map(r => r.type) : [])]);
    let pool = [...types];
    if (S.cheapMaint && S.fleet.length && Math.random() < 0.6) pool = [...new Set(S.fleet.map(f => f.type))];
    if (pool.length) {
      const t = pick(pool), days = rint(2, 4);
      addEvent(S, { kind: 'grounding', title: 'Teknik inceleme', grounded: t, days, text: `Teknik inceleme: tüm ${AC[t].name} uçakları ${days} gün yerde kalacak.`, important: S.fleet.some(f => f.type === t) });
    }
  }

  // Basın: itibar
  if (S.routes.length >= 3 && !has('press') && Math.random() < 0.01) {
    const good = Math.random() < 0.6;
    addEvent(S, good
      ? { kind: 'press', title: 'Olumlu basın', rep: 1.1, days: 30, mine: true, text: 'Dakiklik sıralamasında ilk üçe girdin: itibarın +%10 (30 gün).' }
      : { kind: 'press', title: 'Olumsuz basın', rep: 0.92, days: 20, text: 'Rötar zincirin sosyal medyada gündem oldu: itibarın −%8 (20 gün).' });
  }

  // Karar olayı
  if (!S.pendingDecision && S.fleet.length >= 2 && S.day - (S.lastDecisionDay || 0) > 20 && Math.random() < 0.04) {
    S.decisionLog = S.decisionLog || {};
    const ids = Object.keys(DECISIONS).filter(id => !(id === 'maint' && S.cheapMaint) && !(id === 'hedge' && S.hedgeUntil > S.day)
      && S.day - (S.decisionLog[id] ?? -999) > 150);
    if (ids.length) { const id = pick(ids); S.decisionLog[id] = S.day; S.pendingDecision = { id }; }
  }

  const news = S._newNews;
  delete S._newNews;
  return news;
}
