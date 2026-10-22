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

map.on("click", e => setPin(e.lngLat.lng, e.lngLat.lat, { fly: false, point: e.point }));
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
  current = { lon, lat, place: null, building: null, elev: null };
  const pick = () => {
    const pt = point && !fly ? point : map.project([lon, lat]);
    current.building = describeBuilding(buildingAt(pt));
    map.getSource("sel")?.setData(current.building ? { type: "FeatureCollection", features: [current.building.feature] } : emptyFC());
    render();
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
  const loading = '<span class="loading" aria-label="Cargando"></span>';
  const place = c.place;
  const b = c.building;
  const elevTxt = c.elev === null ? loading : Number.isFinite(c.elev) ? `${nf(c.elev)} m` : "—";
  const facts = [
    `<div class="fact"><span>Elevación del terreno</span><b>${elevTxt}</b><small>sobre el nivel del mar</small></div>`,
    b ? `<div class="fact"><span>Edificio</span><b>${nf(b.area)} m²</b><small>área de la huella</small></div>`
      : `<div class="fact"><span>Edificio</span><b>—</b><small>no hay uno en este punto</small></div>`
  ];
  if (b && b.height && !b.heightEstimated) facts.push(`<div class="fact wide"><span>Altura registrada</span><b>${nf(b.height, b.height < 10 ? 1 : 0)} m · ~${b.levels} ${b.levels === 1 ? "piso" : "pisos"}</b><small>según OpenStreetMap</small></div>`);
  const ico = {
    rio: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 6c2-1.6 3.6-1.6 5 0s3 1.6 5 0 3-1.6 4 0M1 11c2-1.6 3.6-1.6 5 0s3 1.6 5 0 3-1.6 4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    mar: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 12c2.5-1.8 4.5-1.8 7 0s4.5 1.8 7 0M3 8.5C4 4 9 2 13 4.2 10.5 4 9 6 9.6 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sismo: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 8h3l1.5-4 2.5 9 2-7 1.5 3H15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  box.innerHTML = `
    <div class="r-head"><div class="grow">
      <h2>${place ? esc(place.title) : loading}</h2>
      <p>${place ? esc(place.sub) : "Buscando la dirección…"}</p>
    </div><button id="sheetBtn" class="btn" aria-expanded="true">Ocultar</button></div>
    <div class="facts">${facts.join("")}</div>
    <div class="sec">
      <h3>Riesgo del lugar</h3>
      <p>En la siguiente fase se conectan las capas reales para este punto exacto.</p>
      <div class="soon">
        <div><i>${ico.rio}</i>Desborde de ríos y altura sobre el cauce<em>Fase 2</em></div>
        <div><i>${ico.mar}</i>Inundación desde el mar<em>Fase 2</em></div>
        <div><i>${ico.sismo}</i>Terremotos y volcanes<em>Fase 3</em></div>
      </div>
    </div>
    <div class="foot">
      <button class="btn" id="shareBtn"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 8l5-5M8 2.5h3.5V6M11.5 8.5v3h-9v-9h3"/></svg>Copiar enlace</button>
      <span class="coords">${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}</span>
    </div>`;
  $("#shareBtn").onclick = () => copy(location.href, "Enlace copiado");
  const sb = $("#sheetBtn");
  if (box.classList.contains("min")) { sb.textContent = "Ver más"; sb.setAttribute("aria-expanded", "false"); }
  sb.onclick = () => { const m = box.classList.toggle("min"); sb.textContent = m ? "Ver más" : "Ocultar"; sb.setAttribute("aria-expanded", String(!m)); };
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
