// Görsel geri bildirim: uçan para yazıları, konfeti ve kutlama kartı.
const $ = id => document.getElementById(id);

// Bir öğenin yanından yukarı uçup kaybolan yazı ("+$45K")
export function floatText(text, { anchor = 'cash', good = true, big = false } = {}) {
  const a = typeof anchor === 'string' ? $(anchor) : anchor;
  if (!a) return;
  const r = a.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'float-txt ' + (good ? 'pos' : 'neg') + (big ? ' big' : '');
  el.textContent = text;
  el.style.left = (r.left + r.width / 2) + 'px';
  el.style.top = (r.bottom) + 'px';
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// Kasa sayacı kısa bir süre parlar
export function pulse(id, good = true) {
  const el = $(id); if (!el) return;
  el.classList.remove('pulse-pos', 'pulse-neg'); void el.offsetWidth;
  el.classList.add(good ? 'pulse-pos' : 'pulse-neg');
}

// ---------- Konfeti ----------
let cv = null, cx = null, parts = [], running = false;
const COLORS = ['#ffd166', '#06d6a0', '#4cc9f0', '#ef476f', '#f8961e', '#c77dff', '#ffffff'];
export function confetti(n = 140, origin = null) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!cv) {
    cv = document.createElement('canvas'); cv.id = 'confetti';
    document.body.appendChild(cv); cx = cv.getContext('2d');
  }
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ox = origin ? origin.x : innerWidth / 2, oy = origin ? origin.y : innerHeight * 0.35;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 9;
    parts.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, c: COLORS[i % COLORS.length], life: 1 });
  }
  if (!running) { running = true; requestAnimationFrame(step); }
}
function step() {
  cx.clearRect(0, 0, innerWidth, innerHeight);
  for (const p of parts) {
    p.vy += 0.25; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= 0.006;
    cx.save(); cx.globalAlpha = Math.max(0, Math.min(1, p.life * 2)); cx.translate(p.x, p.y); cx.rotate(p.r);
    cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); cx.restore();
  }
  parts = parts.filter(p => p.life > 0 && p.y < innerHeight + 40);
  if (parts.length) requestAnimationFrame(step);
  else { running = false; cx.clearRect(0, 0, innerWidth, innerHeight); }
}

// ---------- Kutlama kartı ----------
export function celebrate({ tag = 'Tebrikler', title, text = '', items = [], button = 'Devam', party = true }) {
  const o = $('celebrate');
  o.querySelector('.tag').textContent = tag;
  o.querySelector('h2').textContent = title;
  o.querySelector('.sub').textContent = text;
  o.querySelector('.cel-list').innerHTML = items.map(i => `<li>${i}</li>`).join('');
  const b = o.querySelector('button');
  b.textContent = button;
  return new Promise(res => {
    b.onclick = () => { o.classList.remove('show'); res(); };
    o.classList.add('show');
    if (!party) return;
    confetti(180);
    setTimeout(() => confetti(90, { x: innerWidth * 0.2, y: innerHeight * 0.5 }), 350);
    setTimeout(() => confetti(90, { x: innerWidth * 0.8, y: innerHeight * 0.5 }), 650);
  });
}
