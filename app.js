/* Umbral — fase 1: mapa mundial a nivel de calle, edificios, búsqueda y ficha del lugar.
   Servicios gratuitos usados:
   - Mapa base: OpenFreeMap (estilo "liberty", datos OpenStreetMap / OpenMapTiles)
   - Elevación: AWS Terrain Tiles (formato Terrarium)
   - Búsqueda: Photon (komoot) y Nominatim (OpenStreetMap) como respaldo
   - Dirección del punto: Nominatim (máximo 1 consulta por segundo) */

const CONFIG = {
  style: "https://tiles.openfreemap.org/styles/liberty",
  terrain: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  photon: "https://photon.komoot.io/api/",
  nominatim: "https://nominatim.openstreetmap.org/",
  start: { center: [-79.8862, -2.1962], zoom: 15.6 }
};

const EXAMPLES = [
  { n: "Malecón de Guayaquil", lat: -2.1949, lon: -79.8806, z: 17 },
  { n: "Babahoyo", lat: -1.8017, lon: -79.5346, z: 16 },
  { n: "Quito, La Carolina", lat: -0.1835, lon: -78.4847, z: 16.5 },
  { n: "Ciudad de Panamá", lat: 8.9824, lon: -79.5199, z: 16 },
  { n: "San Salvador", lat: 13.6929, lon: -89.2182, z: 16 },
  { n: "Venecia", lat: 45.4371, lon: 12.3326, z: 16.5 }
];

const $ = s => document.querySelector(s);
const nf = (v, d = 0) => v.toLocaleString("es", { minimumFractionDigits: d, maximumFractionDigits: d });
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- mapa ---------- */
const params = new URLSearchParams(location.search);
const startPin = (params.get("p") || "").split(",").map(Number);
const hasStartPin = startPin.length === 2 && startPin.every(Number.isFinite);

const map = new maplibregl.Map({
  container: "map",
  style: CONFIG.style,
  center: hasStartPin ? [startPin[1], startPin[0]] : CONFIG.start.center,
  zoom: hasStartPin ? 17 : CONFIG.start.zoom,
  hash: true,
  maxPitch: 70,
  attributionControl: { compact: true, customAttribution: 'Elevación: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a> · Búsqueda: <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a>, <a href="https://nominatim.org" target="_blank" rel="noopener">Nominatim</a>' }
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

map.on("load", () => {
  map.addSource("dem", { type: "raster-dem", tiles: [CONFIG.terrain], tileSize: 256, encoding: "terrarium", maxzoom: 15 });
  const firstSymbol = map.getStyle().layers.find(l => l.type === "symbol")?.id;
  map.addLayer({ id: "relieve", type: "hillshade", source: "dem", layout: { visibility: "none" },
    paint: { "hillshade-exaggeration": 0.55, "hillshade-shadow-color": "#3d4f55", "hillshade-highlight-color": "#ffffff" } }, firstSymbol);

  map.addSource("sel", { type: "geojson", data: emptyFC() });
  map.addLayer({ id: "sel-fill", type: "fill", source: "sel", paint: { "fill-color": "#0f7f8f", "fill-opacity": 0.28 } });
  map.addLayer({ id: "sel-line", type: "line", source: "sel", paint: { "line-color": "#0f7f8f", "line-width": 3 } });

  if (hasStartPin) setPin(startPin[1], startPin[0], { fly: false });
});

/* ---------- herramientas ---------- */
document.querySelector(".tabs").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  document.querySelectorAll(".tabs button").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
  const relieve = b.dataset.base === "relieve";
  if (map.getLayer("relieve")) map.setLayoutProperty("relieve", "visibility", relieve ? "visible" : "none");
  apply3d();
});
let is3d = false;
$("#btn3d").onclick = () => { is3d = !is3d; $("#btn3d").setAttribute("aria-pressed", is3d); apply3d(); };
function apply3d() {
  const relieve = document.querySelector('.tabs button[data-base="relieve"]').classList.contains("on");
  map.setTerrain(is3d && relieve ? { source: "dem", exaggeration: 1.3 } : null);
  map.easeTo({ pitch: is3d ? 60 : 0, bearing: is3d ? map.getBearing() : 0, duration: REDUCED ? 0 : 800 });
}
$("#btnLocate").onclick = () => {
  if (!navigator.geolocation) return toast("Tu navegador no permite ubicarte");
  toast("Buscando tu ubicación…");
  navigator.geolocation.getCurrentPosition(
    p => setPin(p.coords.longitude, p.coords.latitude, { fly: true, zoom: 17 }),
    () => toast("No pudimos obtener tu ubicación. Revisa el permiso del navegador."),
    { enableHighAccuracy: true, timeout: 10000 });
};

/* ---------- pin ---------- */
const pinEl = document.createElement("div");
pinEl.className = "pin";
pinEl.innerHTML = '<svg viewBox="0 0 34 44" width="34" height="44" aria-hidden="true"><path d="M17 43C15.6 38.6 2 27.6 2 16.5a15 15 0 0 1 30 0C32 27.6 18.4 38.6 17 43z" fill="#0f7f8f" stroke="#fff" stroke-width="2.5"/><circle cx="17" cy="16" r="5.5" fill="#fff"/></svg>';
const marker = new maplibregl.Marker({ element: pinEl, anchor: "bottom", draggable: true });
marker.on("dragend", () => { const p = marker.getLngLat(); setPin(p.lng, p.lat, { fly: false }); });

map.on("click", e => window.MODE !== "cumulos" && setPin(e.lngLat.lng, e.lngLat.lat, { fly: false, point: e.point }));
map.on("mousemove", e => {
  const f = buildingAt(e.point);
  map.getCanvas().style.cursor = f ? "pointer" : "";
});

let current = null, reqId = 0;
function setPin(lon, lat, { fly = true, zoom, point } = {}) {
  hideHint();
  marker.setLngLat([lon, lat]).addTo(map);
  if (fly) map.flyTo({ center: [lon, lat], zoom: zoom || Math.max(map.getZoom(), 17), duration: REDUCED ? 0 : 1400, padding: mapPadding() });
  const id = ++reqId;
  current = { lon, lat, place: null, building: null, elev: null, risk: null, fc: { rain: null, river: null }, surface: null };
  // Los análisis de tierra (inundación, lluvia, pronóstico) solo arrancan si el punto es tierra firme
  const startLand = () => {
    if (window.Forecast) {
      const f = Forecast.forecast(lon, lat);
      f.rain.then(v => { if (id === reqId) { current.fc.rain = v; render(); } });
      f.river.then(v => { if (id === reqId) { current.fc.river = v; render(); } });
    }
    if (window.Risk) Risk.analyze(lon, lat, s => { if (id === reqId) { current.risk = s; checkWbm(s); render(); } }).then(s => { if (id === reqId) { current.risk = s; checkWbm(s); render(); } });
  };
  // Respaldo: si la máscara de agua de Copernicus dice mar, río o lago y no hay edificio, se trata como agua
  const checkWbm = s => {
    const w = s && s.raw.wbm;
    if (current.surface === "tierra" && !current.building && w && w.status === "ok" && [1, 2, 3].includes(w.value)) {
      current.surface = { 1: "mar", 2: "lago", 3: "rio" }[w.value];
      map.getSource("sel")?.setData(emptyFC());
    }
  };
  const pick = () => {
    const pt = point && !fly ? point : map.project([lon, lat]);
    const water = waterAt(pt);
    if (water) { current.surface = water; map.getSource("sel")?.setData(emptyFC()); render(); return; }
    current.surface = "tierra";
    current.building = describeBuilding(buildingAt(pt));
    map.getSource("sel")?.setData(current.building ? { type: "FeatureCollection", features: [current.building.feature] } : emptyFC());
    render();
    startLand();
  };
  render();
  if (fly) map.once("idle", () => { if (id === reqId) pick(); }); else pick();
  elevationAt(lon, lat).then(v => { if (id === reqId) { current.elev = v; render(); } });
  reverse(lon, lat).then(r => { if (id === reqId) { current.place = r; render(); } });
  const url = new URL(location.href); url.searchParams.set("p", `${lat.toFixed(6)},${lon.toFixed(6)}`); history.replaceState(null, "", url);
}
function mapPadding() {
  return innerWidth > 820 ? { left: 400, right: 420, top: 40, bottom: 40 } : { top: 200, bottom: innerHeight * 0.48, left: 20, right: 20 };
}

/* ---------- agua: mar, río o lago según el mapa base ---------- */
function waterAt(point) {
  const fs = map.queryRenderedFeatures([point.x, point.y]);
  const poly = fs.find(f => f.sourceLayer === "water" && f.properties.class !== "swimming_pool");
  if (poly) {
    const c = poly.properties.class;
    return c === "ocean" ? "mar" : c === "lake" || c === "pond" ? "lago" : "rio";
  }
  if (map.getZoom() >= 14) {
    const box = [[point.x - 2, point.y - 2], [point.x + 2, point.y + 2]];
    const line = map.queryRenderedFeatures(box).find(f => f.sourceLayer === "waterway" && ["river", "canal"].includes(f.properties.class));
    if (line) return "rio";
  }
  return null;
}

/* ---------- edificios ---------- */
function buildingAt(point) {
  const box = [[point.x - 2, point.y - 2], [point.x + 2, point.y + 2]];
  return map.queryRenderedFeatures(box).find(f => f.sourceLayer === "building") || null;
}
function describeBuilding(f) {
  if (!f) return null;
  const p = f.properties || {};
  const geom = f.geometry;
  const area = polygonArea(geom);
  const height = Number(p.render_height) || null;
  const minH = Number(p.render_min_height) || 0;
  const levels = height ? Math.max(1, Math.round((height - minH) / 3)) : null;
  return {
    area, height, levels, heightEstimated: height === 5,
    feature: { type: "Feature", geometry: geom, properties: {} }
  };
}
function polygonArea(g) {
  const rings = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  let total = 0;
  for (const poly of rings) poly.forEach((ring, k) => { total += (k ? -1 : 1) * Math.abs(ringArea(ring)); });
  return total;
}
function ringArea(r) {
  const R = 6378137, rad = Math.PI / 180; let s = 0;
  for (let i = 0; i < r.length - 1; i++) {
    const [x1, y1] = r[i], [x2, y2] = r[i + 1];
    s += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad));
  }
  return s * R * R / 2;
}
const emptyFC = () => ({ type: "FeatureCollection", features: [] });

/* ---------- elevación (Terrarium) ---------- */
const tileCache = new Map();
async function elevationAt(lon, lat) {
  const z = 14, n = 2 ** z;
  const xf = (lon + 180) / 360 * n;
  const yf = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
  const x = Math.floor(xf), y = Math.floor(yf);
  const key = `${z}/${x}/${y}`;
  try {
    if (!tileCache.has(key)) {
      tileCache.set(key, (async () => {
        const res = await fetch(CONFIG.terrain.replace("{z}", z).replace("{x}", x).replace("{y}", y));
        if (!res.ok) throw new Error(res.status);
        const bmp = await createImageBitmap(await res.blob());
        const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, c.width, c.height);
      })());
    }
    const img = await tileCache.get(key);
    const px = Math.min(img.width - 1, Math.floor((xf - x) * img.width));
    const py = Math.min(img.height - 1, Math.floor((yf - y) * img.height));
    const i = (py * img.width + px) * 4, d = img.data;
    return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
  } catch (e) { tileCache.delete(key); return NaN; }
}

/* ---------- dirección del punto (Nominatim, 1 consulta/segundo) ---------- */
let lastNominatim = 0;
async function nominatim(path) {
  const wait = Math.max(0, lastNominatim + 1100 - Date.now());
  lastNominatim = Date.now() + wait;
  if (wait) await new Promise(r => setTimeout(r, wait));
  const res = await fetch(CONFIG.nominatim + path, { headers: { "Accept-Language": "es" } });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}
async function reverse(lon, lat) {
  try {
    const r = await nominatim(`reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lon}`);
    if (!r || r.error) return { title: "Lugar sin nombre", sub: "" };
    const a = r.address || {};
    const street = [a.road || a.pedestrian || a.path, a.house_number].filter(Boolean).join(" ");
    const title = r.name || street || a.neighbourhood || a.suburb || a.village || a.town || a.city || "Lugar sin nombre";
    const sub = [r.name && street ? street : null, a.neighbourhood || a.suburb, a.city || a.town || a.village, a.state, a.country].filter(Boolean);
    return { title, sub: [...new Set(sub)].filter(s => s !== title).join(" · ") };
  } catch (e) { return { title: "Ubicación seleccionada", sub: "No pudimos obtener la dirección" }; }
}

/* ---------- ficha ---------- */
function render() {
  const c = current, box = $("#result"); if (!c) return;
  if (c.surface && c.surface !== "tierra") return renderWater(c, box);
  const loading = '<span class="loading" aria-label="Cargando"></span>';
  const place = c.place;
  const b = c.building;
  const dem = c.risk && c.risk.raw.dem;
  const demOk = dem && dem.status === "ok" && dem.value !== null;
  const elevVal = demOk ? dem.value : c.elev;
  const elevTxt = elevVal === null ? loading : Number.isFinite(elevVal) ? `${nf(elevVal, elevVal < 10 ? 1 : 0)} m` : "—";
  const facts = [
    `<div class="fact"><span>Elevación del terreno</span><b>${elevTxt}</b><small>sobre el nivel del mar</small></div>`,
    b ? `<div class="fact"><span>Edificio</span><b>${nf(b.area)} m²</b><small>área de la huella</small></div>`
      : `<div class="fact"><span>Edificio</span><b>—</b><small>no hay uno en este punto</small></div>`
  ];
  if (b && b.height && !b.heightEstimated) facts.push(`<div class="fact wide"><span>Altura registrada</span><b>${nf(b.height, b.height < 10 ? 1 : 0)} m · ~${b.levels} ${b.levels === 1 ? "piso" : "pisos"}</b><small>según OpenStreetMap</small></div>`);
  const ico = {
    rio: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 6c2-1.6 3.6-1.6 5 0s3 1.6 5 0 3-1.6 4 0M1 11c2-1.6 3.6-1.6 5 0s3 1.6 5 0 3-1.6 4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    mar: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 12c2.5-1.8 4.5-1.8 7 0s4.5 1.8 7 0M3 8.5C4 4 9 2 13 4.2 10.5 4 9 6 9.6 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    lluvia: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M4.5 9.5a3 3 0 0 1 .4-6A4 4 0 0 1 12.5 5a2.3 2.3 0 0 1 0 4.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.5 11.5l-1 2.5M8.5 11.5l-1 2.5M11.5 11.5l-1 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    sismo: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 8h3l1.5-4 2.5 9 2-7 1.5 3H15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  box.innerHTML = `
    <div class="r-head"><div class="grow">
      <h2>${place ? esc(place.title) : loading}</h2>
      <p>${place ? esc(place.sub) : "Buscando la dirección…"}</p>
    </div><button id="sheetBtn" class="btn" aria-expanded="true">Ocultar</button></div>
    ${riskHtml(c.risk, ico, c.fc)}
    <div class="facts">${facts.join("")}</div>
    <div class="foot">
      <button class="btn" id="shareBtn"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 8l5-5M8 2.5h3.5V6M11.5 8.5v3h-9v-9h3"/></svg>Copiar enlace</button>
      <span class="coords">${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}</span>
    </div>`;
  const rb = $("#retryBtn"); if (rb) rb.onclick = () => setPin(c.lon, c.lat, { fly: false });
  $("#shareBtn").onclick = () => copy(location.href, "Enlace copiado");
  const sb = $("#sheetBtn");
  if (box.classList.contains("min")) { sb.textContent = "Ver más"; sb.setAttribute("aria-expanded", "false"); }
  sb.onclick = () => { const m = box.classList.toggle("min"); sb.textContent = m ? "Ver más" : "Ocultar"; sb.setAttribute("aria-expanded", String(!m)); };
}
function renderWater(c, box) {
  const T = {
    mar: { t: "Este punto está en el mar", p: "Los análisis de inundación, encharcamiento y lluvia aplican solo a tierra firme. Para puntos en el mar, Umbral mostrará amenazas marinas: sismo, tsunami y tormentas tropicales." },
    rio: { t: "Este punto está sobre un río o estero", p: "Los análisis de riesgo aplican solo a tierra firme. Si quieres evaluar un inmueble, mueve el pin a la orilla o búscalo por su dirección." },
    lago: { t: "Este punto está sobre un lago o laguna", p: "Los análisis de riesgo aplican solo a tierra firme. Si quieres evaluar un inmueble, mueve el pin a la orilla o búscalo por su dirección." }
  }[c.surface];
  const wave = '<svg width="20" height="20" viewBox="0 0 16 16"><path d="M1 6c2-1.6 3.6-1.6 5 0s3 1.6 5 0 3-1.6 4 0M1 11c2-1.6 3.6-1.6 5 0s3 1.6 5 0 3-1.6 4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  box.innerHTML = `
    <div class="r-head"><div class="grow"><h2>${c.place && !["Lugar sin nombre", "Ubicación seleccionada"].includes(c.place.title) ? esc(c.place.title) : { mar: "Punto en el mar", rio: "Punto sobre un río", lago: "Punto sobre un lago" }[c.surface]}</h2><p>${c.place && c.place.title !== "Ubicación seleccionada" ? esc(c.place.sub) : ""}</p></div><button id="sheetBtn" class="btn" aria-expanded="true">Ocultar</button></div>
    <div class="verdict water"><b>${wave}${T.t}</b><span>${T.p}</span></div>
    ${c.surface === "mar" ? `<div class="rows">
      <div class="row"><span class="ic"><svg width="20" height="20" viewBox="0 0 16 16"><path d="M1 8h3l1.5-4 2.5 9 2-7 1.5 3H15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span><div><div class="row-t"><strong>Sismo y tsunami</strong><span class="soon-pill">En desarrollo</span></div><p>Zona sísmica, sismos históricos cercanos y tsunamis registrados.</p></div></div>
      <div class="row"><span class="ic">${wave}</span><div><div class="row-t"><strong>Tormentas tropicales</strong><span class="soon-pill">En desarrollo</span></div><p>Trayectorias históricas de huracanes y tormentas que pasaron cerca.</p></div></div>
    </div>` : ""}
    <div class="foot"><span class="coords">${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}</span></div>`;
  const sb = $("#sheetBtn");
  sb.onclick = () => { const m = box.classList.toggle("min"); sb.textContent = m ? "Ver más" : "Ocultar"; sb.setAttribute("aria-expanded", String(!m)); };
}
function riskHtml(R, ico, fc) {
  const spin = '<span class="loading" aria-label="Cargando"></span>';
  const LV = ["low", "med", "high", "vhigh"];
  const pill = l => `<span class="lvl" style="color:var(--${LV[l]});background:color-mix(in srgb,var(--${LV[l]}) 14%,transparent)">${Risk.LEVELS[l]}</span>`;
  if (!R) return `<div class="verdict pending"><b>Analizando el riesgo ${spin}</b><span>Leyendo los mapas de inundación para este punto exacto.</span></div>`;
  const row = (k, title, part, loadingTxt) => `<div class="row"><span class="ic" style="${part && part.lvl ? `color:var(--${LV[part.lvl]})` : ""}">${ico[k]}</span><div><div class="row-t"><strong>${title}</strong>${!part ? spin : part.lvl === null ? '<span class="soon-pill">Sin dato</span>' : pill(part.lvl)}</div><p>${part ? esc(part.why) : loadingTxt}</p></div></div>`;
  const top = R.top;
  const verdict = R.failedAll
    ? `<div class="verdict pending"><b>No pudimos analizar este punto</b><span>Los mapas de riesgo no respondieron. <button class="link" id="retryBtn">Intentar de nuevo</button></span></div>`
    : top === null
    ? `<div class="verdict pending"><b>Analizando el riesgo ${spin}</b><span>${R.loaded} de ${R.total} capas leídas. La primera consulta de una zona puede tardar unos segundos.</span></div>`
    : `<div class="verdict" style="background:color-mix(in srgb,var(--${LV[top]}) 13%,transparent)"><b style="color:var(--${LV[top]})">Riesgo de inundación ${Risk.LEVELS[top].toLowerCase()}</b><span>${R.partial && R.done ? "Resultado parcial: una de las capas no respondió. " : ""}${top === 0 ? "No encontramos amenazas de inundación importantes en este punto." : `Lo que más pesa aquí: ${{ rio: "el desborde de ríos", lluvia: "el encharcamiento por lluvia", mar: "las marejadas" }[R.parts.filter(p => p.lvl !== null).sort((a, b) => b.lvl - a.lvl)[0].k]}.`}${R.done ? "" : ` ${spin}`}</span></div>`;
  const r = R.raw, d = s => s && s.status === "ok" ? (s.value && s.value > 0.05 ? `${nf(s.value, 2)} m` : "0 m") : s && s.status === "nocover" ? "sin cobertura" : s ? "no disponible" : "…";
  const hand = r.hand && r.hand.status === "ok" && r.hand.value !== null ? `${nf(r.hand.value, 1)} m` : d(r.hand);
  const dem = r.dem && r.dem.status === "ok" && r.dem.value !== null ? `${nf(r.dem.value, 1)} m` : d(r.dem);
  const failed = Object.entries(r).filter(([, s]) => s.status === "error").map(([k]) => k);
  return `${verdict}
    <div class="rows">
      ${row("rio", "Desborde de ríos", R.fluv, "Leyendo el mapa de crecidas y la altura sobre el cauce…")}
      ${row("lluvia", "Encharcamiento por lluvia", R.pluv, "Analizando el relieve alrededor del punto…")}
      ${row("mar", "Inundación desde el mar", R.coast, "Leyendo el mapa costero…")}
      <div class="row"><span class="ic">${ico.sismo}</span><div><div class="row-t"><strong>Terremotos y volcanes</strong><span class="soon-pill">Fase 3</span></div><p>Se agregan en la siguiente fase, empezando por Ecuador y Centroamérica.</p></div></div>
    </div>
    ${forecastHtml(fc, ico)}
    <details class="tech-wrap"><summary><svg width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Ver datos técnicos</summary>
      <div class="tech">
        <div><span>Crecida 1 en 10 años</span><b>${d(r.fl10)}</b></div>
        <div><span>Crecida 1 en 100 años</span><b>${d(r.fl100)}</b></div>
        <div><span>Crecida 1 en 500 años</span><b>${d(r.fl500)}</b></div>
        <div><span>Máx. a menos de 150 m (1 en 100)</span><b>${r.fl100 && r.fl100.status === "ok" && r.fl100.max ? nf(r.fl100.max, 2) + " m" : d(r.fl100)}</b></div>
        <div><span>Altura sobre el cauce (HAND)</span><b>${hand}</b></div>
        <div><span>Elevación (Copernicus 30 m)</span><b>${dem}</b></div>
        <div><span>Marejada 1 en 100 años</span><b>${d(r.coast100)}</b></div>
        <div><span>Hondonada (vs. terreno a ~250 m)</span><b>${R.pluv && R.pluv.terrain ? `${R.pluv.terrain.depression > 0 ? "" : "+"}${nf(-R.pluv.terrain.depression, 1)} m` : "…"}</b></div>
        <div><span>Pendiente del terreno</span><b>${R.pluv && R.pluv.terrain && R.pluv.terrain.slope !== null ? nf(R.pluv.terrain.slope, 1) + " %" : "…"}</b></div>
        ${failed.length ? `<p class="warn">Algunas capas no respondieron (${failed.join(", ")}). El resultado se calculó con las demás.</p>` : ""}
        <p>Fuentes: JRC/Copernicus GloFAS (ríos, celda ~90 m), ASF HAND y Copernicus DEM (30 m), WRI Aqueduct (mar, celda ~1 km). El encharcamiento es un indicador del relieve: no considera alcantarillado ni drenajes, y en ciudades los edificios pueden exagerar las hondonadas. Los mapas globales no consideran muros ni diques de protección. Es una estimación para orientar, no un estudio técnico.</p>
      </div></details>`;
}
function forecastHtml(fc, ico) {
  const spin = '<span class="loading" aria-label="Cargando"></span>';
  const LV = ["low", "med", "high", "vhigh"];
  const RAIN_TXT = ["Sin lluvias fuertes", "Lluvia moderada", "Lluvia fuerte", "Lluvia muy fuerte"];
  const pill = (l, txt) => `<span class="lvl" style="color:var(--${LV[l]});background:color-mix(in srgb,var(--${LV[l]}) 14%,transparent)">${txt}</span>`;
  const rain = fc && fc.rain, riv = fc && fc.river;
  let rainHtml;
  if (!rain) rainHtml = `<p class="fc-msg">${spin} Consultando el pronóstico de lluvia…</p>`;
  else if (rain.error) rainHtml = `<p class="fc-msg">No pudimos obtener el pronóstico de lluvia en este momento.</p>`;
  else {
    const W = 330, H = 120, top = 18, base = 92, n = rain.days.length, bw = W / n;
    const scaleMax = Math.max(60, rain.maxDay * 1.15);
    const y = mm => base - (mm / scaleMax) * (base - top);
    const col = mm => mm >= 100 ? "var(--vhigh)" : mm >= 50 ? "var(--high)" : mm >= 20 ? "var(--med)" : "var(--rain)";
    const dn = ds => new Date(ds + "T12:00:00Z").toLocaleDateString("es", { weekday: "short", timeZone: "UTC" }).replace(".", "");
    const bars = rain.days.map((d, i) => {
      const x = i * bw + bw * 0.18, w = bw * 0.64, yy = Math.min(y(d.mm), base - (d.mm > 0.05 ? 2 : 0));
      return `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${w.toFixed(1)}" height="${(base - yy).toFixed(1)}" rx="3" fill="${col(d.mm)}"/>
        <text x="${(x + w / 2).toFixed(1)}" y="${(yy - 5).toFixed(1)}" class="v">${d.mm >= 0.5 ? nf(d.mm, d.mm < 10 ? 1 : 0) : "0"}</text>
        <text x="${(x + w / 2).toFixed(1)}" y="${base + 16}" class="d">${i === 0 ? "hoy" : dn(d.date)}</text>`;
    }).join("");
    const y50 = y(50);
    const msg = rain.lvl === 0
      ? `No se esperan lluvias fuertes. Máximo: ${nf(rain.maxDay, 0)} mm en un día.`
      : `El día más lluvioso sería el ${rain.peak.date === rain.days[0].date ? "de hoy" : new Date(rain.peak.date + "T12:00:00Z").toLocaleDateString("es", { weekday: "long", day: "numeric", timeZone: "UTC" })}, con unos ${nf(rain.peak.mm, 0)} mm${rain.maxHour >= 20 ? ` y aguaceros de hasta ${nf(rain.maxHour, 0)} mm en una hora` : ""}.`;
    rainHtml = `<div class="fc-row"><span class="ic">${ico.lluvia}</span><div><div class="row-t"><strong>Lluvia</strong>${pill(rain.lvl, RAIN_TXT[rain.lvl])}</div><p>${msg} Próximas 24 h: ${nf(rain.next24, rain.next24 < 10 ? 1 : 0)} mm.</p></div></div>
      <svg class="fc-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lluvia pronosticada por día, en milímetros">
        ${y50 > top ? `<line x1="0" x2="${W}" y1="${y50.toFixed(1)}" y2="${y50.toFixed(1)}" class="th"/><text x="${W - 2}" y="${(y50 - 4).toFixed(1)}" class="tl">50 mm</text>` : ""}
        <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="ax"/>${bars}</svg>`;
  }
  let rivHtml;
  if (!riv) rivHtml = `<p class="fc-msg">${spin} Consultando el caudal del río más cercano…</p>`;
  else if (riv.error) rivHtml = `<p class="fc-msg">No pudimos obtener el pronóstico del río en este momento.</p>`;
  else if (riv.none) rivHtml = `<div class="fc-row"><span class="ic">${ico.rio}</span><div><div class="row-t"><strong>Río más cercano</strong></div><p>No hay un río grande a menos de unos 5 km.</p></div></div>`;
  else {
    const RTXT = ["Caudal normal", "Caudal alto", "Crecida", "Crecida excepcional"];
    const when = new Date(riv.peak.date + "T12:00:00Z").toLocaleDateString("es", { weekday: "long", day: "numeric", timeZone: "UTC" });
    rivHtml = `<div class="fc-row"><span class="ic">${ico.rio}</span><div><div class="row-t"><strong>Río más cercano</strong>${pill(riv.lvl, RTXT[riv.lvl])}</div><p>Caudal máximo esperado: ${nf(riv.peak.q, riv.peak.q < 10 ? 1 : 0)} m³/s el ${when}. Es mayor que el ${nf(Math.min(riv.pct, 99.9), riv.pct > 99 ? 1 : 0)} % de los días desde el año 2000 (caudal típico: ${nf(riv.p50, riv.p50 < 10 ? 1 : 0)} m³/s).</p></div></div>`;
  }
  return `<div class="sec fc"><h3>Próximos días <small>${rain && rain.updated ? "pronóstico de " + new Date(rain.updated).toLocaleString("es", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "en tiempo real"}</small></h3>${rainHtml}${rivHtml}
    <p class="fc-src">Lluvia: <a href="https://api.met.no/" target="_blank" rel="noopener">MET Norway</a> (CC BY 4.0). Caudal: GloFAS vía <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, río principal a menos de ~5 km.</p></div>`;
}
const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

/* ---------- búsqueda ---------- */
const q = $("#q"), sg = $("#sugg");
let items = [], si = 0, timer = 0, searchId = 0;
function parseCoords(s) {
  const m = s.replace(/;/g, ",").match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const a = parseFloat(m[1]), b = parseFloat(m[2]);
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lon: b };
}
function showItems(list, msg) {
  items = list; si = 0;
  if (!list.length) { sg.innerHTML = `<div class="msg">${msg || "Sin resultados"}</div>`; sg.hidden = false; return; }
  sg.innerHTML = list.map((it, k) => `<button role="option" data-k="${k}" class="${k ? "" : "on"}"><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></button>`).join("");
  sg.hidden = false;
}
async function photon(text) {
  const c = map.getCenter();
  const res = await fetch(`${CONFIG.photon}?q=${encodeURIComponent(text)}&limit=6&lat=${c.lat}&lon=${c.lng}`);
  if (!res.ok) throw new Error(res.status);
  const data = await res.json();
  return data.features.map(f => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates;
    const street = [p.street, p.housenumber].filter(Boolean).join(" ");
    const title = p.name || street || p.city || p.country;
    const sub = [p.name && street ? street : null, p.district, p.city, p.state, p.country].filter(Boolean).filter(s => s !== title);
    return { title, sub: [...new Set(sub)].join(" · "), lat, lon, extent: p.extent };
  });
}
async function nominatimSearch(text) {
  const r = await nominatim(`search?format=jsonv2&limit=6&q=${encodeURIComponent(text)}`);
  return r.map(x => ({ title: x.name || x.display_name.split(",")[0], sub: x.display_name.split(",").slice(1, 4).join(" ·").trim(), lat: +x.lat, lon: +x.lon }));
}
q.addEventListener("input", () => {
  clearTimeout(timer);
  const v = q.value.trim();
  if (!v) { sg.hidden = true; return; }
  const c = parseCoords(v);
  if (c) return showItems([{ title: "Ir a estas coordenadas", sub: `${c.lat}, ${c.lon}`, ...c }]);
  if (v.length < 3) return;
  timer = setTimeout(async () => {
    const id = ++searchId;
    try { const list = await photon(v); if (id === searchId) showItems(list, "No encontramos ese lugar. Prueba con otra forma de escribirlo o con coordenadas."); }
    catch (e) { if (id === searchId) showItems([], "La búsqueda no respondió. Intenta de nuevo en unos segundos."); }
  }, 320);
});
q.addEventListener("keydown", async e => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (!sg.hidden && items.length) return pick(si);
    const v = q.value.trim(); if (!v) return;
    try { showItems(await nominatimSearch(v), "No encontramos ese lugar."); } catch (err) { showItems([], "La búsqueda no respondió."); }
    return;
  }
  if (sg.hidden || !items.length) return;
  if (e.key === "ArrowDown") si = (si + 1) % items.length;
  else if (e.key === "ArrowUp") si = (si - 1 + items.length) % items.length;
  else if (e.key === "Escape") { sg.hidden = true; return; }
  else return;
  e.preventDefault();
  sg.querySelectorAll("button").forEach((b, k) => b.classList.toggle("on", k === si));
});
sg.addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (b) pick(+b.dataset.k); });
document.addEventListener("click", e => { if (!e.target.closest(".search")) sg.hidden = true; });
function pick(k) {
  const it = items[k]; if (!it) return;
  q.value = it.title; sg.hidden = true; q.blur();
  setPin(it.lon, it.lat, { fly: true, zoom: 17.5 });
}

/* ---------- ejemplos ---------- */
$("#examples").insertAdjacentHTML("beforeend", EXAMPLES.map((x, k) => `<button class="chip" data-k="${k}">${x.n}</button>`).join(""));
$("#examples").addEventListener("click", e => {
  const b = e.target.closest("[data-k]"); if (!b) return;
  const x = EXAMPLES[+b.dataset.k]; setPin(x.lon, x.lat, { fly: true, zoom: x.z });
});

/* ---------- utilidades de interfaz ---------- */
function hideHint() { const h = $("#hint"); if (h) { h.style.opacity = 0; setTimeout(() => h.remove(), 400); } }
setTimeout(hideHint, 8000);
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200); }
function copy(text, msg) {
  const done = () => toast(msg);
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => fallback());
  else fallback();
  function fallback() { const a = document.createElement("textarea"); a.value = text; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("No se pudo copiar"); } a.remove(); }
}
function placeTools() {
  const tools = $("#tools");
  if (innerWidth <= 820) document.documentElement.style.setProperty("--tools-top", ($("#top").getBoundingClientRect().bottom + 8) + "px");
}
addEventListener("resize", placeTools); placeTools();
