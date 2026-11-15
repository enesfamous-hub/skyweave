// Senaryolar: farklı başlangıç koşulları, süreli hedefler ve 1–3 yıldız.
import * as sim from './sim.js';
import { companyValue } from './progress.js';

const { AP } = sim;
const longest = S => S.routes.reduce((m, r) => Math.max(m, sim.distKm(AP[r.a], AP[r.b])), 0);

// parts: hepsi tamamlanınca senaryo kazanılır. days: süre.
export const SCENARIOS = [
  { id: 'free', name: 'Serbest oyun', icon: '🌍', desc: 'Hedef yok, süre yok. Üssünü seç ve dilediğin gibi büyü.' },
  { id: 'tour', level: 'Kolay', name: 'Tatil cenneti', icon: '🏖️', base: 'AYT', days: 365,
    desc: "Antalya'dan başla. Bir yılda 3 milyon yolcu taşı. Yazları turistik yerlerin talebi patlar, kışın düşer.",
    parts: [{ label: 'Toplam yolcu', val: S => S.totalPax, target: 3e6 }] },
  { id: 'east', level: 'Zor', name: "Doğu'nun kanatları", icon: '🏔️', base: 'ERZ', days: 150,
    desc: "Erzurum'dan başla: çevren küçük şehirlerle dolu, talep az. 150 gün içinde Ulusal lisansı al ve 15 hat işlet.",
    parts: [{ label: 'Lisans', val: S => S.tier, target: 2, fmt: v => v >= 2 ? 'Ulusal' : 'Bölgesel' }, { label: 'Hat', val: S => S.routes.length, target: 15 }] },
  { id: 'crisis', level: 'Orta', name: 'Kriz yılı', icon: '📉', base: 'ESB', days: 365, cash: 6e6,
    desc: "Ankara'dan, 6 M$ ile başla. İlk 150 gün yakıt %35 pahalı. Bir yılda şirket değerini 60 M$'a çıkar.",
    setup: S => { S.events.push({ id: -1, kind: 'fuel', title: 'Yakıt krizi', text: 'Yakıt fiyatları %35 arttı (150 gün).', global: true, fuel: 1.35, from: 0, until: 150 }); },
    parts: [{ label: 'Şirket değeri', val: S => companyValue(S), target: 60e6, money: true }] },
  { id: 'cargo', level: 'Orta', name: 'Kargo kralı', icon: '📦', base: 'IST', days: 300,
    desc: "İstanbul'dan başla. 300 günde toplam 30.000 ton kargo taşı. Büyük uçaklar ve uluslararası hatlar daha çok kargo taşır.",
    parts: [{ label: 'Taşınan kargo (ton)', val: S => S.totalCargo || 0, target: 3e4 }] },
  { id: 'hunter', level: 'Zor', name: 'Şirket avcısı', icon: '🏢', base: 'SAW', days: 450,
    desc: "Sabiha Gökçen'den başla. 450 gün içinde iki rakip havayolunu satın al.",
    parts: [{ label: 'Satın alınan rakip', val: S => (S.acquired || []).length, target: 2 }] },
  { id: 'world', level: 'Orta', name: 'Dünya turu', icon: '🧭', base: 'IST', days: 600,
    desc: "600 günde Uluslararası lisansı al ve 9.000 km'den uzun bir hat aç.",
    parts: [{ label: 'Lisans', val: S => S.tier, target: 4, fmt: v => ['', 'Bölgesel', 'Ulusal', 'Kıtasal', 'Uluslararası'][v] }, { label: 'En uzun hat (km)', val: longest, target: 9000 }] },
];
export const scenarioOf = S => S && S.scenario ? SCENARIOS.find(x => x.id === S.scenario.id) : null;

export function applyScenario(S, id) {
  const sc = SCENARIOS.find(x => x.id === id);
  if (!sc || sc.id === 'free') return S;
  if (sc.cash) S.cash = sc.cash + (S.cash - 15e6);
  S.scenario = { id: sc.id, days: sc.days, won: null, lost: false };
  if (sc.setup) sc.setup(S);
  return S;
}

export function scenarioProgress(S) {
  const sc = scenarioOf(S);
  if (!sc) return null;
  return sc.parts.map(p => { const v = p.val(S); return { ...p, cur: v, done: v >= p.target }; });
}

// Gün sonunda: kazanma/kaybetme. Bir kez döner.
export const starsFor = (sc, day) => day <= sc.days * 0.5 ? 3 : day <= sc.days * 0.75 ? 2 : 1;
export function checkScenario(S) {
  const sc = scenarioOf(S);
  if (!sc || S.scenario.won != null || S.scenario.lost) return null;
  const parts = scenarioProgress(S);
  if (parts.every(p => p.done)) {
    S.scenario.won = S.day;
    S.scenario.stars = starsFor(sc, S.day);
    return { won: true, stars: S.scenario.stars, sc };
  }
  if (S.day >= sc.days) { S.scenario.lost = true; return { won: false, sc }; }
  return null;
}
