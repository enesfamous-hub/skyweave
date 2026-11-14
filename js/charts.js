// Basit SVG grafikler (çizgi ve sütun). Dokununca değer gösterir.
const W = 360;
const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const col = c => /^#[0-9a-f]{3,8}$|^var\(--[a-z-]+\)$/i.test(c || '') ? c : '#8ea3bd';

function axisFmt(fmt, v) { return fmt ? fmt(v) : String(Math.round(v)); }

// series: [{ values: number[], color, fill? }], labels: string[] (her nokta için)
export function lineChart({ series, labels = [], height = 120, fmt, zero = false, min, max }) {
  const n = Math.max(...series.map(s => s.values.length));
  if (n < 2) return '<p class="meta">Grafik için en az 2 gün gerekir.</p>';
  const all = series.flatMap(s => s.values).filter(v => v != null && isFinite(v));
  let lo = min ?? Math.min(...all), hi = max ?? Math.max(...all);
  if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const H = height, pt = 8, pb = 4;
  const x = i => (i / (n - 1)) * W, y = v => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  const paths = series.map(s => {
    const pts = s.values.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean);
    const line = `<polyline points="${pts.join(' ')}" fill="none" stroke="${col(s.color)}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
    const area = s.fill ? `<polygon points="0,${H} ${pts.join(' ')} ${W},${H}" fill="${col(s.color)}" opacity="0.12"/>` : '';
    return area + line;
  }).join('');
  const zl = lo < 0 && hi > 0 ? `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(255,255,255,0.25)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : '';
  const data = encodeURIComponent(JSON.stringify({ s: series.map(s => ({ v: s.values, c: s.color, l: s.label || '' })), l: labels }));
  return `<div class="chart" data-chart="${data}" data-fmt="${fmt ? fmt.name : ''}">
    <div class="chart-ax"><span>${axisFmt(fmt, hi)}</span><span>${axisFmt(fmt, lo)}</span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">${zl}${paths}<line class="cursor" x1="-10" x2="-10" y1="0" y2="${H}" stroke="rgba(255,255,255,0.4)" vector-effect="non-scaling-stroke"/></svg>
    <div class="chart-tip"></div>
    <div class="chart-x"><span>${esc(labels[0])}</span><span>${esc(labels[n - 1])}</span></div></div>`;
}

export function barChart({ values, labels = [], height = 90, fmt, good = 'var(--good)', bad = 'var(--bad)' }) {
  if (!values.length) return '<p class="meta">Henüz veri yok.</p>';
  const max = Math.max(1e-9, ...values.map(Math.abs));
  const hasNeg = values.some(v => v < 0);
  const bars = values.map((v, i) => {
    const h = Math.abs(v) / max * (hasNeg ? 50 : 100);
    const style = hasNeg ? (v >= 0 ? `bottom:50%;height:${h}%` : `top:50%;height:${h}%`) : `bottom:0;height:${h}%`;
    return `<div class="bar"><i style="${style};background:${col(v >= 0 ? good : bad)}"></i></div>`;
  }).join('');
  return `<div class="chart bars2" style="height:${height}px" data-vals="${encodeURIComponent(JSON.stringify(values))}" data-labels="${encodeURIComponent(JSON.stringify(labels))}">${hasNeg ? '<i class="mid"></i>' : ''}${bars}<div class="chart-tip"></div></div>`;
}

// Grafiklere dokununca/üzerine gelince değer göster
export function bindCharts(root, fmts = {}) {
  root.querySelectorAll('.chart[data-chart]').forEach(el => {
    const d = JSON.parse(decodeURIComponent(el.dataset.chart));
    const fmt = fmts[el.dataset.fmt] || (v => String(Math.round(v)));
    const svg = el.querySelector('svg'), cur = el.querySelector('.cursor'), tip = el.querySelector('.chart-tip');
    const n = Math.max(...d.s.map(s => s.v.length));
    const show = ev => {
      const r = svg.getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const i = Math.max(0, Math.min(n - 1, Math.round(px / r.width * (n - 1))));
      const xx = i / (n - 1) * W;
      cur.setAttribute('x1', xx); cur.setAttribute('x2', xx);
      tip.innerHTML = `<b>${esc(d.l[i])}</b> ` + d.s.map(s => `<span style="color:${col(s.c)}">${esc(s.l ? s.l + ' ' : '')}${esc(s.v[i] == null ? '—' : fmt(s.v[i]))}</span>`).join(' · ');
      tip.classList.add('show');
    };
    const hide = () => { tip.classList.remove('show'); cur.setAttribute('x1', -10); cur.setAttribute('x2', -10); };
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerdown', show);
    el.addEventListener('pointerleave', hide);
  });
  root.querySelectorAll('.chart.bars2').forEach(el => {
    const vals = JSON.parse(decodeURIComponent(el.dataset.vals)), labels = JSON.parse(decodeURIComponent(el.dataset.labels));
    const tip = el.querySelector('.chart-tip'), fmt = fmts.money || (v => String(v));
    const show = ev => {
      const r = el.getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const i = Math.max(0, Math.min(vals.length - 1, Math.floor(px / r.width * vals.length)));
      el.querySelectorAll('.bar').forEach((b, j) => b.classList.toggle('hl', j === i));
      tip.innerHTML = `<b>${esc(labels[i])}</b> ${esc(fmt(vals[i]))}`; tip.classList.add('show');
    };
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerdown', show);
    el.addEventListener('pointerleave', () => { tip.classList.remove('show'); el.querySelectorAll('.bar.hl').forEach(b => b.classList.remove('hl')); });
  });
}
