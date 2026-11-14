// Dünya haritası: MapLibre küre görünümü + OpenStreetMap verisi (OpenFreeMap).
// Uzaktan küre, yakınlaşınca gerçek harita; havalimanında gerçek pistler ve 3B binalar.
/* global maplibregl */

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const R = 6371;
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

// Büyük daire noktaları (boylamlar kesintisiz).
function greatCircle(a, b, n = 96) {
  const toV = p => { const la = rad(p.lat), lo = rad(p.lon); return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]; };
  const A = toV(a), B = toV(b);
  const om = Math.acos(Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  const pts = [];
  let prev = a.lon;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let v = A;
    if (om > 1e-6) { const s = Math.sin(om), k1 = Math.sin((1 - t) * om) / s, k2 = Math.sin(t * om) / s; v = [A[0] * k1 + B[0] * k2, A[1] * k1 + B[1] * k2, A[2] * k1 + B[2] * k2]; }
    const lat = deg(Math.atan2(v[2], Math.hypot(v[0], v[1])));
    let lon = deg(Math.atan2(v[1], v[0]));
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    prev = lon;
    pts.push([lon, lat]);
  }
  return pts;
}

function bearing(p, q) {
  const [lo1, la1] = p.map(rad), [lo2, la2] = q.map(rad);
  const y = Math.sin(lo2 - lo1) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Uçak simgesi (kuzeye bakan), SDF olarak renklendirilir.
function planeIcon() {
  const s = 64, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff';
  c.translate(s / 2, s / 2);
  c.beginPath();
  c.moveTo(0, -28); c.quadraticCurveTo(4, -24, 4, -14);
  c.lineTo(4, -6); c.lineTo(27, 6); c.lineTo(27, 11); c.lineTo(4, 5);
  c.lineTo(3, 18); c.lineTo(11, 24); c.lineTo(11, 28); c.lineTo(0, 25);
  c.lineTo(-11, 28); c.lineTo(-11, 24); c.lineTo(-3, 18);
  c.lineTo(-4, 5); c.lineTo(-27, 11); c.lineTo(-27, 6); c.lineTo(-4, -6);
  c.lineTo(-4, -14); c.quadraticCurveTo(-4, -24, 0, -28);
  c.fill();
  return c.getImageData(0, 0, s, s);
}

// Gece bölgesi: güneşin aydınlatmadığı yarıküre (çokgen).
function nightPolygon(date) {
  const doy = (date - Date.UTC(date.getUTCFullYear(), 0, 1)) / 864e5;
  const decl = -23.44 * Math.cos(2 * Math.PI * (doy + 10) / 365);
  const sunLon = (12 - date.getUTCHours() - date.getUTCMinutes() / 60) * 15;
  const tanD = Math.tan(rad(Math.abs(decl) < 0.1 ? 0.1 : decl));
  const ring = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const lat = deg(Math.atan(-Math.cos(rad(lon - sunLon)) / tanD));
    ring.push([lon, Math.max(-85, Math.min(85, lat))]);
  }
  const pole = decl > 0 ? -85 : 85;
  ring.push([180, pole], [-180, pole], ring[0]);
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
}

const fc = features => ({ type: 'FeatureCollection', features });

export class Globe {
  constructor(el, { onAirportClick } = {}) {
    this.onAirportClick = onAirportClick;
    this.planes = [];
    this.lastPlaneUpdate = 0;
    this.nightKey = '';
    this.loaded = false;
    this.pending = {};
    this.map = new maplibregl.Map({
      container: el,
      style: STYLE,
      center: [35, 39],
      zoom: 2.2,
      maxPitch: 75,
      attributionControl: { compact: true },
    });
    this.map.on('style.load', () => this.setup());
  }

  setup() {
    const map = this.map;
    try { map.setProjection({ type: 'globe' }); } catch (_) { /* eski sürüm */ }
    try {
      map.setSky({ 'sky-color': '#9fc6e8', 'horizon-color': '#dbe8f4', 'fog-color': '#eef3f8', 'sky-horizon-blend': 0.6, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.6, 10, 0] });
    } catch (_) { /* gökyüzü desteklenmiyor */ }
    map.addImage('plane', planeIcon(), { sdf: true, pixelRatio: 2 });

    const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id;

    // Havalimanı alanları ve pistler (gerçek OSM verisi), stilin kendi katmanlarından daha belirgin
    map.addLayer({
      id: 'sw-aeroway-area', type: 'fill', source: 'openmaptiles', 'source-layer': 'aeroway', minzoom: 10,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': ['match', ['get', 'class'], 'runway', '#4a4f57', 'taxiway', '#7b8088', 'apron', '#c9ccd1', 'aerodrome', '#e4ebe1', '#d5d8dc'],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11.5, 1],
      },
    }, firstSymbol);
    map.addLayer({
      id: 'sw-taxiway', type: 'line', source: 'openmaptiles', 'source-layer': 'aeroway', minzoom: 11,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#8a8f97', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 11, 0.8, 15, 6, 18, 50] },
    }, firstSymbol);
    map.addLayer({
      id: 'sw-runway', type: 'line', source: 'openmaptiles', 'source-layer': 'aeroway', minzoom: 9,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']],
      layout: { 'line-cap': 'butt' },
      paint: { 'line-color': '#3f444c', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 9, 1.5, 15, 13, 18, 105] },
    }, firstSymbol);
    map.addLayer({
      id: 'sw-runway-center', type: 'line', source: 'openmaptiles', 'source-layer': 'aeroway', minzoom: 13,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']],
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 13, 0.4, 18, 3], 'line-dasharray': [4, 3] },
    }, firstSymbol);

    // 3B binalar: terminaller, hangarlar, şehir
    map.addLayer({
      id: 'sw-buildings-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#e3e6ea', 30, '#cfd6de', 80, '#b8c2cd'],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, ['max', 6, ['coalesce', ['get', 'render_height'], 6]]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.92,
      },
    });

    // Gece gölgesi
    map.addSource('night', { type: 'geojson', data: fc([]) });
    map.addLayer({ id: 'sw-night', type: 'fill', source: 'night', paint: { 'fill-color': '#0a1530', 'fill-opacity': 0.32, 'fill-antialias': false } }, firstSymbol);

    // Rotalar, önizleme, uçaklar, havalimanları
    map.addSource('rivals', { type: 'geojson', data: fc([]) });
    map.addLayer({
      id: 'sw-rival-routes', type: 'line', source: 'rivals',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.4, 'line-opacity': 0.45, 'line-dasharray': [3, 2] },
    });
    map.addSource('routes', { type: 'geojson', data: fc([]) });
    map.addLayer({
      id: 'sw-routes', type: 'line', source: 'routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'sel'], 5, 3], 'line-opacity': 0.9 },
    });
    map.addSource('preview', { type: 'geojson', data: fc([]) });
    map.addLayer({
      id: 'sw-preview', type: 'line', source: 'preview',
      paint: { 'line-color': ['case', ['get', 'ok'], '#1d3557', '#ef476f'], 'line-width': 3, 'line-dasharray': [2, 1.5] },
    });

    map.addSource('airports', { type: 'geojson', data: fc([]) });
    map.addLayer({
      id: 'sw-ap-circle', type: 'circle', source: 'airports',
      paint: {
        'circle-color': ['match', ['get', 'st'], 'base', '#ffb703', 'net', '#1d3557', 'locked', '#a3adb8', '#3d6a92'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          1, ['case', ['==', ['get', 'st'], 'base'], 5, ['min', 4.5, ['+', 2, ['/', ['get', 'pop'], 6]]]],
          6, ['case', ['==', ['get', 'st'], 'base'], 9, 7], 12, 11],
        'circle-stroke-color': ['match', ['get', 'tgt'], 1, '#06d6a0', 2, '#ffffff', ['case', ['get', 'sel'], '#ef476f', '#ffffff']],
        'circle-stroke-width': ['case', ['any', ['==', ['get', 'tgt'], 1], ['get', 'sel']], 4, 2],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, ['case', ['==', ['get', 'tgt'], 2], 0.35, 1], 13.5, 0],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, ['case', ['==', ['get', 'tgt'], 2], 0.35, 1], 13.5, 0],
        'circle-pitch-alignment': 'map',
      },
    });
    map.addLayer({
      id: 'sw-ap-label', type: 'symbol', source: 'airports',
      layout: {
        'text-field': ['step', ['zoom'], ['get', 'name'], 11, ['concat', ['get', 'name'], ' Havalimanı']],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 11, 10, 14],
        'text-offset': [0, 1.0], 'text-anchor': 'top',
        'symbol-sort-key': ['get', 'sort'],
      },
      paint: { 'text-color': '#1b2a3c', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
    });
    map.addLayer({ id: 'sw-ap-hit', type: 'circle', source: 'airports', paint: { 'circle-radius': 18, 'circle-opacity': 0 } });

    // Olay işaretleri (fırtına, grev, festival...)
    map.addSource('events', { type: 'geojson', data: fc([]) });
    map.addLayer({
      id: 'sw-events', type: 'circle', source: 'events',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 10, 8, 18],
        'circle-color': ['get', 'color'], 'circle-opacity': 0.22,
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.9,
      },
    });
    map.addLayer({
      id: 'sw-events-label', type: 'symbol', source: 'events',
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, -1.9], 'text-allow-overlap': true },
      paint: { 'text-color': '#ffffff', 'text-halo-color': ['get', 'color'], 'text-halo-width': 2.2 },
    });

    map.addSource('planes', { type: 'geojson', data: fc([]) });
    map.addLayer({
      id: 'sw-planes', type: 'symbol', source: 'planes',
      layout: {
        'icon-image': 'plane', 'icon-rotate': ['get', 'brg'], 'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.35, 6, 0.6, 12, 1],
      },
      paint: { 'icon-color': ['get', 'color'], 'icon-halo-color': '#1b2a3c', 'icon-halo-width': 1.2 },
    });

    map.on('click', 'sw-ap-hit', e => {
      const f = e.features && e.features[0];
      if (f && this.onAirportClick) this.onAirportClick(f.properties.code);
    });
    map.on('mouseenter', 'sw-ap-hit', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'sw-ap-hit', () => { map.getCanvas().style.cursor = ''; });

    // Yakınlaşınca kamerayı otomatik eğ: binalar 3B görünsün.
    map.on('moveend', () => {
      if (this.autoTilting) { this.autoTilting = false; return; }
      const z = map.getZoom(), p = map.getPitch();
      if (z >= 12.5 && p < 25) { this.autoTilting = true; map.easeTo({ pitch: 58, duration: 900 }); }
      else if (z < 9 && p > 5) { this.autoTilting = true; map.easeTo({ pitch: 0, duration: 700 }); }
    });

    this.loaded = true;
    for (const [k, v] of Object.entries(this.pending)) map.getSource(k).setData(v);
    this.pending = {};
  }

  setData(id, data) {
    if (this.loaded) this.map.getSource(id).setData(data);
    else this.pending[id] = data;
  }

  // airports: [{code, name, lat, lon, st, tgt, pop, sel, sort}]
  setAirports(list) {
    this.setData('airports', fc(list.map(a => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: { code: a.code, name: a.name, st: a.st, tgt: a.tgt, pop: a.pop, sel: !!a.sel, sort: a.sort },
    }))));
  }

  // routes: [{id, a, b, color}]
  setRoutes(routes, selectedId) {
    this.setData('routes', fc(routes.map(r => ({
      type: 'Feature', geometry: { type: 'LineString', coordinates: greatCircle(r.a, r.b) },
      properties: { color: r.color, sel: r.id === selectedId },
    }))));
  }

  // events: [{lat, lon, label, color}]
  setEvents(list) {
    this.setData('events', fc(list.map(e => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: { label: e.label, color: e.color } }))));
  }

  // Rakip hatları: ince, kesikli, rakibin renginde
  setRivalRoutes(list) {
    this.setData('rivals', fc(list.map(r => ({
      type: 'Feature', geometry: { type: 'LineString', coordinates: greatCircle(r.a, r.b, 48) }, properties: { color: r.color },
    }))));
  }

  setPreview(a, b, ok) {
    this.setData('preview', fc(a && b ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: greatCircle(a, b) }, properties: { ok: !!ok } }] : []));
  }

  // planes: [{a, b, color, rt (saat), dwell (0-0.5), phase}]
  setPlanes(planes) {
    this.planes = planes.map(p => ({ ...p, pts: greatCircle(p.a, p.b, 128) }));
    this.lastPlaneUpdate = 0;
  }

  updatePlanes(tHours) {
    const now = performance.now();
    if (now - this.lastPlaneUpdate < 33) return; // ~30 fps
    this.lastPlaneUpdate = now;
    const feats = [];
    for (const p of this.planes) {
      const cyc = ((tHours / p.rt) + p.phase) % 1;
      const fwd = cyc < 0.5;
      const half = fwd ? cyc * 2 : (cyc - 0.5) * 2;
      if (half < p.dwell) continue; // yerde
      let u = (half - p.dwell) / (1 - p.dwell);
      if (!fwd) u = 1 - u;
      const n = p.pts.length - 1, f = u * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
      const a = p.pts[i], b = p.pts[i + 1];
      const pos = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      let brg = bearing(a, b);
      if (!fwd) brg = (brg + 180) % 360;
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: pos }, properties: { color: p.color, brg } });
    }
    this.setData('planes', fc(feats));
  }

  setSun(date) {
    const key = Math.floor(date.getTime() / (15 * 60e3)); // 15 dakikada bir
    if (key === this.nightKey) return;
    this.nightKey = key;
    this.setData('night', fc([nightPolygon(date)]));
  }

  get zoom() { return this.map.getZoom(); }

  flyTo(lat, lon, zoom) {
    this.map.flyTo({ center: [lon, lat], zoom: zoom ?? this.map.getZoom(), pitch: 0, essential: true, duration: 2200 });
  }

  render() { /* MapLibre kendi çiziyor */ }
}
