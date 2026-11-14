// Ses efektleri, arka plan müziği ve titreşim. Hepsi Web Audio ile üretilir (dosya yok).
import { settings } from './settings.js';

let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;

function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyVolume();
  return ctx;
}

export function applyVolume() {
  if (!ctx) return;
  master.gain.value = settings.volume;
  sfxBus.gain.value = settings.sfx ? 0.9 : 0;
  musicBus.gain.setTargetAtTime(settings.music && !document.hidden ? 0.22 : 0, ctx.currentTime, 0.6);
  if (settings.music) startMusic();
}

// Tarayıcılar sesi ilk dokunuştan sonra açar
function unlock() {
  if (!init()) return;
  if (ctx.state === 'suspended') ctx.resume();
  applyVolume();
}
['pointerdown', 'keydown', 'touchend'].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));
document.addEventListener('visibilitychange', () => { if (ctx) { if (document.hidden) ctx.suspend(); else { ctx.resume(); applyVolume(); } } });

// ---------- Yapı taşları ----------
function tone(freq, t0, dur, { type = 'sine', vol = 0.3, attack = 0.005, slide = 0, bus = sfxBus } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(bus);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise(t0, dur, { vol = 0.2, f0 = 400, f1 = 3000, q = 0.8 } = {}) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true;
  f.type = 'bandpass'; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(sfxBus);
  s.start(t0); s.stop(t0 + dur + 0.05);
}

const SFX = {
  click: t => tone(1400, t, 0.04, { type: 'triangle', vol: 0.06 }),
  coin: t => { tone(988, t, 0.09, { type: 'square', vol: 0.07 }); tone(1319, t + 0.07, 0.25, { type: 'square', vol: 0.07 }); },
  loss: t => { tone(330, t, 0.18, { type: 'triangle', vol: 0.12, slide: 0.8 }); tone(247, t + 0.12, 0.25, { type: 'triangle', vol: 0.1, slide: 0.8 }); },
  buy: t => { tone(660, t, 0.06, { type: 'triangle', vol: 0.15 }); tone(880, t + 0.05, 0.06, { type: 'triangle', vol: 0.15 }); tone(1760, t + 0.1, 0.3, { vol: 0.1 }); noise(t, 0.08, { vol: 0.05, f0: 3000, f1: 6000 }); },
  takeoff: t => { noise(t, 2.2, { vol: 0.22, f0: 180, f1: 1800, q: 0.6 }); tone(90, t, 2.0, { type: 'sawtooth', vol: 0.03, slide: 2.2, attack: 0.6 }); },
  notify: t => { tone(784, t, 0.12, { vol: 0.12 }); tone(1175, t + 0.1, 0.3, { vol: 0.1 }); },
  bad: t => { tone(220, t, 0.25, { type: 'sawtooth', vol: 0.06 }); tone(208, t + 0.02, 0.25, { type: 'sawtooth', vol: 0.06 }); },
  error: t => { tone(200, t, 0.09, { type: 'square', vol: 0.06 }); tone(150, t + 0.1, 0.14, { type: 'square', vol: 0.06 }); },
  goal: t => [784, 988, 1175, 1568].forEach((f, i) => tone(f, t + i * 0.07, 0.3, { type: 'triangle', vol: 0.12 })),
  record: t => { [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, t + i * 0.06, 0.4, { vol: 0.09 })); noise(t + 0.2, 0.6, { vol: 0.04, f0: 5000, f1: 9000 }); },
  fanfare: t => {
    const seq = [[523, 0, 0.18], [659, 0.16, 0.18], [784, 0.32, 0.18], [1047, 0.5, 0.7]];
    for (const [f, d, l] of seq) { tone(f, t + d, l, { type: 'sawtooth', vol: 0.07, attack: 0.02 }); tone(f / 2, t + d, l, { type: 'triangle', vol: 0.1 }); }
    [1047, 1319, 1568].forEach(f => tone(f, t + 0.5, 1.4, { vol: 0.07, attack: 0.05 }));
    noise(t + 0.5, 1.2, { vol: 0.05, f0: 4000, f1: 9000 });
  },
};

export function play(name) {
  if (!settings.sfx || !ctx || ctx.state !== 'running' || !SFX[name]) return;
  SFX[name](ctx.currentTime + 0.01);
}

const VIBES = { buy: 15, coin: 10, error: [25, 40, 25], fanfare: [40, 60, 40, 60, 120], record: [30, 50, 80], goal: [20, 40, 40], bad: 60, notify: 20, takeoff: [10, 30, 10] };
export function buzz(name) {
  if (!settings.haptics || !navigator.vibrate || (navigator.userActivation && !navigator.userActivation.hasBeenActive)) return;
  const p = VIBES[name] ?? (typeof name === 'number' ? name : 0);
  if (p) try { navigator.vibrate(p); } catch (_) { /* yok */ }
}
export function fx(name) { play(name); buzz(name); }

// ---------- Müzik: sakin, kendi kendine akan ambient ----------
// Yavaş değişen akorlar (I–vi–IV–V gibi) ve seyrek pentatonik notalar.
const CHORDS = [[57, 64, 69, 72], [53, 60, 65, 69], [55, 62, 67, 71], [52, 59, 64, 67], [50, 57, 62, 65]];
const SCALE = [69, 72, 74, 76, 79, 81, 84];
const midi = m => 440 * Math.pow(2, (m - 69) / 12);
let musicOn = false, nextChord = 0, chordIdx = 0, musicTimer = 0, delay = null;

function startMusic() {
  if (musicOn || !ctx) return;
  musicOn = true;
  delay = ctx.createDelay(1.0); delay.delayTime.value = 0.55;
  const fb = ctx.createGain(); fb.gain.value = 0.35;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
  delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(musicBus);
  nextChord = ctx.currentTime + 0.3;
  musicTimer = setInterval(schedule, 400);
}

function pad(freq, t0, dur) {
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o1.type = 'sawtooth'; o2.type = 'triangle';
  o1.frequency.value = freq; o2.frequency.value = freq * 1.003;
  f.type = 'lowpass'; f.frequency.setValueAtTime(500, t0); f.frequency.linearRampToValueAtTime(1100, t0 + dur / 2); f.frequency.linearRampToValueAtTime(500, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.05, t0 + dur * 0.35);
  g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(musicBus);
  o1.start(t0); o2.start(t0); o1.stop(t0 + dur + 0.1); o2.stop(t0 + dur + 0.1);
}
function pluck(freq, t0) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.08, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
  o.connect(g); g.connect(musicBus); g.connect(delay);
  o.start(t0); o.stop(t0 + 2);
}

function schedule() {
  if (!ctx || ctx.state !== 'running' || !settings.music) return;
  const LEN = 8;
  while (nextChord < ctx.currentTime + 1.2) {
    const ch = CHORDS[chordIdx % CHORDS.length];
    ch.forEach(m => pad(midi(m - 12), nextChord, LEN + 1.5));
    pad(midi(ch[0] - 24), nextChord, LEN + 1.5);
    for (let i = 0; i < 6; i++) if (Math.random() < 0.45) pluck(midi(SCALE[Math.floor(Math.random() * SCALE.length)]), nextChord + i * (LEN / 6) + Math.random() * 0.3);
    nextChord += LEN;
    chordIdx += Math.random() < 0.8 ? 1 : 2;
  }
}
