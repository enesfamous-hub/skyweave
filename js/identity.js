// Havayolu kimliği: renk, logo ve uçak boyası.
export const BRAND_COLORS = ['#ffc233', '#ef476f', '#e63946', '#f8961e', '#06d6a0', '#2a9d8f', '#4cc9f0', '#3a86ff', '#7b2cbf', '#c77dff', '#ff99c8', '#e9eef5'];
export const LOGOS = ['✈', '🕊️', '🦅', '⭐', '🌙', '☀️', '🌷', '🏔️', '🌊', '🔥', '🦁', '🐺', '🌿', '💎', '🧿', '⚓'];
export const LIVERIES = [
  { id: 'classic', name: 'Klasik', desc: 'Beyaz gövde, renkli kuyruk' },
  { id: 'full', name: 'Tam boya', desc: 'Renkli gövde, beyaz kuyruk' },
  { id: 'dark', name: 'Gece', desc: 'Koyu gövde, renkli kuyruk' },
  { id: 'mono', name: 'Tek renk', desc: 'Gövde ve kuyruk aynı renk' },
];
export const DEFAULT_BRAND = { color: '#ffc233', logo: '✈', livery: 'classic' };

const okColor = c => /^#[0-9a-f]{6}$/i.test(c || '');
export function brandOf(S) {
  const b = (S && S.brand) || {};
  return {
    color: okColor(b.color) ? b.color : DEFAULT_BRAND.color,
    logo: LOGOS.includes(b.logo) ? b.logo : DEFAULT_BRAND.logo,
    livery: LIVERIES.some(l => l.id === b.livery) ? b.livery : DEFAULT_BRAND.livery,
  };
}

// 3B uçak renkleri
export function liveryColors(b) {
  const W = '#f3f5f8', D = '#26323f';
  switch (b.livery) {
    case 'full': return { tail: W, body: b.color, wing: W };
    case 'dark': return { tail: b.color, body: D, wing: '#3b4856' };
    case 'mono': return { tail: b.color, body: b.color, wing: W };
    default: return { tail: b.color, body: W, wing: W };
  }
}

// Yandan uçak görünümü (önizleme ve başlık için)
export function planeSvg(b, w = 220) {
  const c = liveryColors(b);
  return `<svg viewBox="0 0 220 80" width="${w}" height="${w * 80 / 220}" aria-hidden="true">
    <path d="M24 50 Q14 50 12 44 Q14 38 28 37 L176 35 Q200 36 208 44 Q200 52 176 52 L30 53 Z" fill="${c.body}" stroke="#0b1522" stroke-width="1.5"/>
    <path d="M30 37 L12 8 L34 8 L62 36 Z" fill="${c.tail}" stroke="#0b1522" stroke-width="1.5"/>
    <path d="M96 46 L70 70 L88 70 L130 47 Z" fill="${c.wing}" stroke="#0b1522" stroke-width="1.5" opacity="0.95"/>
    <rect x="98" y="52" width="22" height="9" rx="4" fill="#98a2ad" stroke="#0b1522" stroke-width="1"/>
    ${[60, 74, 88, 102, 116, 130, 144, 158].map(x => `<rect x="${x}" y="40" width="6" height="5" rx="1.5" fill="#1b2a3c" opacity="0.75"/>`).join('')}
    <path d="M186 39 L198 41 L198 45 L186 44 Z" fill="#1b2a3c" opacity="0.8"/>
    <line x1="30" y1="47" x2="176" y2="46" stroke="${b.livery === 'classic' ? b.color : c.tail}" stroke-width="2.5"/>
    <text x="30" y="27" font-size="15" text-anchor="middle">${b.logo}</text>
  </svg>`;
}
