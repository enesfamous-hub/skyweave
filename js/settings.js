// Ayarlar (cihaza özel) ve kayıt dışa/içe aktarma.
const KEY = 'skyweave-settings';
const DEFAULTS = { sfx: true, music: true, volume: 0.6, haptics: true, speed: 1, tips: true, tipsSeen: [], cb: false, scen: {} };

export const settings = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) { return { ...DEFAULTS }; }
})();
export function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (_) { /* depolama yok */ } }

// ---------- Kayıt kodu ----------
// Biçim: "SW1." + base64(gzip(JSON)); gzip yoksa "SW0." + base64(JSON)
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

export async function encodeSave(S) {
  const raw = new TextEncoder().encode(JSON.stringify(S));
  if (typeof CompressionStream === 'function') return 'SW1.' + b64(await pipe(raw, new CompressionStream('gzip')));
  return 'SW0.' + b64(raw);
}

export async function decodeSave(text) {
  text = String(text || '').trim();
  let json;
  if (text.startsWith('{')) json = text;
  else {
    const m = text.replace(/\s+/g, '').match(/^SW([01])\.(.+)$/);
    if (!m) throw new Error('Kayıt kodu tanınmadı.');
    let bytes = unb64(m[2]);
    if (m[1] === '1') {
      if (typeof DecompressionStream !== 'function') throw new Error('Bu tarayıcı sıkıştırılmış kodu açamıyor.');
      bytes = await pipe(bytes, new DecompressionStream('gzip'));
    }
    json = new TextDecoder().decode(bytes);
  }
  const s = JSON.parse(json);
  if (!s || s.v !== 2 || !Array.isArray(s.fleet) || !Array.isArray(s.routes) || !Array.isArray(s.bases)) throw new Error('Bu bir SkyWeave kaydı değil.');
  return s;
}

export function downloadText(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
