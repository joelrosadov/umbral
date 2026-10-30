/* Umbral — módulo de cúmulos de riesgo.
   Carga una cartera (Excel o CSV) en el navegador, ubica cada riesgo en el mapa
   y calcula cuánta suma asegurada se concentra dentro de un radio.
   Nada se envía a ningún servidor: el archivo se lee y se procesa localmente. */

(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const RADII = [0.5, 1, 5, 25];
  const S = { rows: [], cols: null, radius: 1, focos: [], sel: null, currency: "", loaded: false, file: "" };
  window.MODE = "ubicar";

  /* ---------- cambio de módulo ---------- */
  document.querySelector(".modes").addEventListener("click", e => {
    const b = e.target.closest("button[data-mode]"); if (!b) return;
    setMode(b.dataset.mode);
  });
  function setMode(m) {
    window.MODE = m;
    if (typeof hideHint === "function") hideHint();
    document.body.classList.toggle("mode-cumulos", m === "cumulos");
    document.querySelectorAll(".modes button").forEach(x => { const on = x.dataset.mode === m; x.classList.toggle("on", on); x.setAttribute("aria-selected", on); });
    $("#modeUbicar").hidden = m !== "ubicar";
    $("#modeCumulos").hidden = m !== "cumulos";
    $("#tagline").textContent = m === "ubicar" ? "¿Qué riesgos tiene este lugar?" : "¿Dónde se concentra la cartera?";
    $("#result").hidden = m !== "ubicar";
    $("#cumul").hidden = m !== "cumulos" || !S.sel;
    if (m !== "cumulos") document.body.classList.remove("cu-detail");
    const pin = document.querySelector(".pin"); if (pin) pin.style.display = m === "ubicar" ? "" : "none";
    ["cu-heat", "cu-pts", "cu-foco-fill", "cu-foco-line"].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, "visibility", m === "cumulos" ? "visible" : "none"));
    if (map.getSource("sel")) map.setLayoutProperty("sel-fill", "visibility", m === "ubicar" ? "visible" : "none"), map.setLayoutProperty("sel-line", "visibility", m === "ubicar" ? "visible" : "none");
    if (m === "cumulos" && S.loaded) fitAll();
    if (typeof placeTools === "function") placeTools();
  }
  window.setUmbralMode = setMode;
  if (window.ResizeObserver && typeof placeTools === "function") new ResizeObserver(() => placeTools()).observe($("#top"));

  /* ---------- lectura del archivo ---------- */
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, fail) => { const s = document.createElement("script"); s.src = "vendor/xlsx.full.min.js"; s.onload = ok; s.onerror = () => fail(new Error("No se pudo cargar el lector de Excel")); document.head.appendChild(s); });
  }
  $("#cuFile").addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    status(`Leyendo ${esc(f.name)}…`);
    try {
      await loadXlsx();
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
      if (!raw.length) throw new Error("La primera hoja está vacía.");
      S.file = f.name; ingest(raw);
    } catch (err) { status(`<span class="cu-err">No pudimos leer el archivo: ${esc(err.message)}</span>`); }
    e.target.value = "";
  });
  $("#cuSample").onclick = () => { S.file = "Datos de ejemplo (ficticios)"; ingest(sampleRows()); };

  /* ---------- columnas ---------- */
  const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const GUESS = {
    lat: ["latitud", "lat", "latitude", "coord y", "y"],
    lon: ["longitud", "lon", "lng", "long", "longitude", "coord x", "x"],
    suma: ["suma asegurada", "suma asegurada total", "valor asegurado", "suma", "sa", "tiv", "monto asegurado", "monto", "valor"],
    ramo: ["ramo", "linea", "linea de negocio", "producto", "cobertura"],
    cedente: ["cedente", "aseguradora", "compania", "compania cedente", "cliente"],
    asegurado: ["asegurado", "nombre", "riesgo", "nombre del riesgo", "nombre asegurado"],
    moneda: ["moneda", "currency", "divisa"],
    pais: ["pais", "country"],
    dir: ["direccion", "ubicacion", "address", "ciudad"]
  };
  function guessCols(keys) {
    const nk = keys.map(k => [k, norm(k)]), used = new Set(), out = {};
    for (const [field, cands] of Object.entries(GUESS)) {
      let hit = null;
      for (const c of cands) { hit = nk.find(([k, n]) => !used.has(k) && n === c); if (hit) break; }
      if (!hit) for (const c of cands) { if (c.length < 3) continue; hit = nk.find(([k, n]) => !used.has(k) && n.includes(c)); if (hit) break; }
      if (hit) { out[field] = hit[0]; used.add(hit[0]); }
    }
    return out;
  }
  const num = v => {
    if (typeof v === "number") return v;
    let s = String(v).trim().replace(/[^\d,.\-]/g, "");
    if (!s) return NaN;
    if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else if (s.includes(",")) s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
    return parseFloat(s);
  };

  let RAW = [];
  function ingest(raw) {
    RAW = raw;
    S.cols = guessCols(Object.keys(raw[0]));
    build();
  }
  function build() {
    const c = S.cols;
    S.rows = RAW.map((r, i) => ({
      i, lat: num(r[c.lat]), lon: num(r[c.lon]), suma: num(r[c.suma]),
      ramo: c.ramo ? String(r[c.ramo] || "Sin ramo") : "Sin ramo",
      cedente: c.cedente ? String(r[c.cedente] || "Sin cedente") : "Sin cedente",
      asegurado: c.asegurado ? String(r[c.asegurado] || "") : "",
      moneda: c.moneda ? String(r[c.moneda] || "").trim().toUpperCase() : "",
      dir: c.dir ? String(r[c.dir] || "") : ""
    }));
    S.rows.forEach(r => { r.ok = Number.isFinite(r.lat) && Number.isFinite(r.lon) && Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180 && !(r.lat === 0 && r.lon === 0); if (!Number.isFinite(r.suma) || r.suma < 0) r.suma = 0; });
    const cur = [...new Set(S.rows.map(r => r.moneda).filter(Boolean))];
    S.currency = cur.length === 1 ? cur[0] : cur.length ? "MIXTA" : "";
    S.loaded = true; S.sel = null;
    renderMap(); computeFocos(); renderSummary(); fitAll();
    $("#cumul").hidden = true;
  }

  /* ---------- cálculo ---------- */
  const R_EARTH = 6371;
  const hav = (a, b) => { const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r; const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2; return 2 * R_EARTH * Math.asin(Math.sqrt(s)); };
  function grid(pts, cellDeg) {
    const g = new Map();
    for (const p of pts) { const k = `${Math.floor(p.lat / cellDeg)},${Math.floor(p.lon / cellDeg)}`; (g.get(k) || g.set(k, []).get(k)).push(p); }
    return g;
  }
  function within(center, km, g, cellDeg) {
    const out = [], cy = Math.floor(center.lat / cellDeg), cx = Math.floor(center.lon / cellDeg), reach = Math.ceil(km / 111 / cellDeg / Math.max(0.2, Math.cos(center.lat * Math.PI / 180))) + 1;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const cell = g.get(`${cy + dy},${cx + dx}`); if (!cell) continue;
      for (const p of cell) if (hav(center, p) <= km) out.push(p);
    }
    return out;
  }
  function computeFocos() {
    const pts = S.rows.filter(r => r.ok), km = S.radius, cellDeg = Math.max(km / 111, 0.002);
    const g = grid(pts, cellDeg);
    const scored = pts.map(p => { const w = within(p, km, g, cellDeg); return { p, sum: w.reduce((a, x) => a + x.suma, 0), n: w.length }; }).sort((a, b) => b.sum - a.sum);
    const picked = [];
    for (const s of scored) {
      if (picked.length >= 8) break;
      if (picked.some(f => hav(f.p, s.p) < km * 2)) continue;
      // centra el foco en el promedio ponderado de los riesgos que abarca
      const w = within(s.p, km, g, cellDeg), tot = w.reduce((a, x) => a + x.suma, 0) || 1;
      const c = { lat: w.reduce((a, x) => a + x.lat * x.suma, 0) / tot, lon: w.reduce((a, x) => a + x.lon * x.suma, 0) / tot };
      const w2 = within(c, km, g, cellDeg), sum2 = w2.reduce((a, x) => a + x.suma, 0);
      picked.push(sum2 >= s.sum ? { p: c, sum: sum2, n: w2.length } : { p: { lat: s.p.lat, lon: s.p.lon }, sum: s.sum, n: s.n });
    }
    picked.sort((a, b) => b.sum - a.sum);
    S.focos = picked; S.grid = { g, cellDeg };
    S.focos.forEach(f => { f.name = null; });
    nameFocos();
  }
  async function nameFocos() {
    const list = S.focos;
    for (const f of list) {
      if (S.focos !== list) return;
      try { const r = await reverse(f.p.lon, f.p.lat); f.name = r && !["Lugar sin nombre", "Ubicación seleccionada"].includes(r.title) ? [r.title, (r.sub || "").split(" · ").slice(-3, -1).join(", ")].filter(Boolean).join(" · ") : null; } catch (e) {}
      renderSummary();
    }
  }
  function accumulate(center) {
    const { g, cellDeg } = S.grid;
    const w = within(center, S.radius, g, cellDeg).sort((a, b) => b.suma - a.suma);
    const sum = w.reduce((a, x) => a + x.suma, 0);
    const by = key => Object.entries(w.reduce((m, x) => (m[x[key]] = (m[x[key]] || 0) + x.suma, m), {})).sort((a, b) => b[1] - a[1]);
    return { center, list: w, sum, n: w.length, ramos: by("ramo"), cedentes: by("cedente") };
  }

  /* ---------- formato ---------- */
  const money = v => {
    const c = S.currency && S.currency !== "MIXTA" ? S.currency + " " : "";
    if (v >= 1e9) return c + (v / 1e9).toLocaleString("es", { maximumFractionDigits: 2 }) + " mil M";
    if (v >= 1e6) return c + (v / 1e6).toLocaleString("es", { maximumFractionDigits: 1 }) + " M";
    if (v >= 1e3) return c + (v / 1e3).toLocaleString("es", { maximumFractionDigits: 0 }) + " mil";
    return c + v.toLocaleString("es", { maximumFractionDigits: 0 });
  };
  const pct = (a, b) => b ? (a / b * 100).toLocaleString("es", { maximumFractionDigits: a / b < 0.1 ? 1 : 0 }) + " %" : "—";
  const total = () => S.rows.reduce((a, r) => a + r.suma, 0);
  const status = h => { $("#cuSummary").innerHTML = `<p class="cu-status">${h}</p>`; };

  /* ---------- panel izquierdo ---------- */
  function renderSummary() {
    $(".cu-intro").hidden = S.loaded;
    const ok = S.rows.filter(r => r.ok), miss = S.rows.length - ok.length, T = total();
    const c = S.cols, keys = Object.keys(RAW[0] || {});
    const sel = (field, label, need) => `<label>${label}<select data-col="${field}"><option value="">${need ? "— elegir —" : "(ninguna)"}</option>${keys.map(k => `<option${c[field] === k ? " selected" : ""}>${esc(k)}</option>`).join("")}</select></label>`;
    const needs = !c.lat || !c.lon || !c.suma;
    $("#cuSummary").innerHTML = `
      <div class="cu-file">${esc(S.file)}</div>
      <div class="cu-kpis">
        <div><span>Riesgos</span><b>${S.rows.length.toLocaleString("es")}</b></div>
        <div><span>Suma asegurada</span><b>${money(T)}</b></div>
        <div><span>Sin ubicar</span><b class="${miss ? "warn" : ""}">${miss.toLocaleString("es")}</b></div>
      </div>
      ${S.currency === "MIXTA" ? `<p class="cu-err">La cartera mezcla monedas. Las sumas no son comparables hasta convertirlas a una sola moneda.</p>` : ""}
      ${needs ? `<p class="cu-err">Indica qué columnas tienen la latitud, la longitud y la suma asegurada.</p>` : ""}
      ${miss && !needs ? `<p class="cu-note">${miss} riesgos no tienen coordenadas válidas y no entran en el cálculo.</p>` : ""}
      <details class="cu-cols"${needs ? " open" : ""}><summary>Columnas del archivo</summary><div class="cu-colgrid">
        ${sel("lat", "Latitud", 1)}${sel("lon", "Longitud", 1)}${sel("suma", "Suma asegurada", 1)}${sel("ramo", "Ramo")}${sel("cedente", "Cedente")}${sel("asegurado", "Asegurado")}${sel("moneda", "Moneda")}
      </div></details>
      <div class="cu-radius"><span>Radio del cúmulo</span><div class="tabs">${RADII.map(r => `<button data-r="${r}" class="${S.radius === r ? "on" : ""}">${r < 1 ? r * 1000 + " m" : r + " km"}</button>`).join("")}</div></div>
      <h3 class="cu-h">Mayores cúmulos</h3>
      ${S.focos.length ? `<ol class="cu-focos">${S.focos.map((f, k) => `<li data-k="${k}" class="${S.sel && S.sel.k === k ? "on" : ""}"><span class="rk">${k + 1}</span><span class="nm">${f.name ? esc(f.name) : `${f.p.lat.toFixed(3)}, ${f.p.lon.toFixed(3)}`}<small>${f.n} riesgos · ${pct(f.sum, T)} de la cartera</small></span><b>${money(f.sum)}</b><i style="width:${(f.sum / S.focos[0].sum * 100).toFixed(1)}%"></i></li>`).join("")}</ol>` : `<p class="cu-note">Sin cúmulos que mostrar.</p>`}
      <p class="cu-note">Toca cualquier punto del mapa para medir el cúmulo a su alrededor.</p>`;
    $("#cuSummary").querySelectorAll("select[data-col]").forEach(s => s.onchange = () => { S.cols[s.dataset.col] = s.value || undefined; build(); });
    $("#cuSummary").querySelectorAll("button[data-r]").forEach(b => b.onclick = () => { S.radius = +b.dataset.r; computeFocos(); renderSummary(); if (S.sel) select(S.sel.center, S.sel.k); });
    $("#cuSummary").querySelectorAll(".cu-focos li").forEach(li => li.onclick = () => { const f = S.focos[+li.dataset.k]; select(f.p, +li.dataset.k, true); });
  }

  /* ---------- mapa ---------- */
  function circle(c, km, n = 64) {
    const pts = []; for (let i = 0; i <= n; i++) { const a = i / n * 2 * Math.PI; pts.push([c.lon + km / (111.32 * Math.cos(c.lat * Math.PI / 180)) * Math.cos(a), c.lat + km / 110.57 * Math.sin(a)]); }
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [pts] }, properties: {} };
  }
  function ensureLayers() {
    if (map.getSource("cartera")) return;
    map.addSource("cartera", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("foco", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "cu-heat", type: "heatmap", source: "cartera", maxzoom: 13, paint: {
      "heatmap-weight": ["get", "w"], "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 12, 2],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 14, 12, 36],
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.85, 13, 0],
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(15,127,143,0)", 0.2, "rgba(15,127,143,.45)", 0.45, "#e6b53a", 0.7, "#e06a2c", 1, "#d23a4f"] } });
    map.addLayer({ id: "cu-foco-fill", type: "fill", source: "foco", paint: { "fill-color": "#0f7f8f", "fill-opacity": 0.12 } });
    map.addLayer({ id: "cu-foco-line", type: "line", source: "foco", paint: { "line-color": "#0f7f8f", "line-width": 2, "line-dasharray": [2, 1.5] } });
    map.addLayer({ id: "cu-pts", type: "circle", source: "cartera", paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, ["+", 2, ["*", 6, ["sqrt", ["get", "w"]]]], 14, ["+", 4, ["*", 18, ["sqrt", ["get", "w"]]]]],
      "circle-color": "#0f7f8f", "circle-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.35, 13, 0.75],
      "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 } });
    map.on("click", e => {
      if (window.MODE !== "cumulos" || !S.loaded) return;
      select({ lat: e.lngLat.lat, lon: e.lngLat.lng }, null, false);
    });
    map.on("mousemove", "cu-pts", () => { if (window.MODE === "cumulos") map.getCanvas().style.cursor = "pointer"; });
  }
  function renderMap() {
    const go = () => {
      ensureLayers();
      const max = Math.max(1, ...S.rows.filter(r => r.ok).map(r => r.suma));
      map.getSource("cartera").setData({ type: "FeatureCollection", features: S.rows.filter(r => r.ok).map(r => ({ type: "Feature", geometry: { type: "Point", coordinates: [r.lon, r.lat] }, properties: { w: r.suma / max } })) });
      map.getSource("foco").setData({ type: "FeatureCollection", features: [] });
      setMode("cumulos");
    };
    map.isStyleLoaded() ? go() : map.once("load", go);
  }
  function fitAll() {
    const ok = S.rows.filter(r => r.ok); if (!ok.length) return;
    const b = ok.reduce((b, r) => b.extend([r.lon, r.lat]), new maplibregl.LngLatBounds([ok[0].lon, ok[0].lat], [ok[0].lon, ok[0].lat]));
    map.fitBounds(b, { padding: innerWidth > 820 ? { left: 420, right: 60, top: 60, bottom: 60 } : { top: 260, bottom: 60, left: 30, right: 30 }, maxZoom: 13, duration: 900 });
  }

  /* ---------- detalle del cúmulo ---------- */
  function select(center, k, fly) {
    const a = accumulate(center);
    S.sel = { center, k };
    map.getSource("foco").setData({ type: "FeatureCollection", features: [circle(center, S.radius)] });
    if (fly) map.fitBounds(circleBounds(center, S.radius * 1.6), { padding: innerWidth > 820 ? { left: 420, right: 430, top: 60, bottom: 60 } : { top: 130, bottom: innerHeight * 0.52, left: 20, right: 20 }, duration: 900 });
    renderDetail(a, k);
    renderSummary();
  }
  function circleBounds(c, km) { const dy = km / 110.57, dx = km / (111.32 * Math.cos(c.lat * Math.PI / 180)); return [[c.lon - dx, c.lat - dy], [c.lon + dx, c.lat + dy]]; }
  function bars(list, T) {
    const top = list.slice(0, 5), rest = list.slice(5).reduce((a, x) => a + x[1], 0);
    if (rest > 0) top.push(["Otros", rest]);
    return `<div class="cu-bars">${top.map(([n, v]) => `<div><span class="nm">${esc(n)}</span><span class="bar"><i style="width:${(v / (list[0] ? list[0][1] : 1) * 100).toFixed(1)}%"></i></span><b>${money(v)}</b><small>${pct(v, T)}</small></div>`).join("")}</div>`;
  }
  function renderDetail(a, k) {
    const box = $("#cumul"), T = total();
    const f = k !== null && k !== undefined ? S.focos[k] : null;
    const rad = S.radius < 1 ? S.radius * 1000 + " m" : S.radius + " km";
    box.hidden = false;
    document.body.classList.add("cu-detail");
    box.innerHTML = `
      <div class="r-head"><div class="grow"><h2>${f ? `Cúmulo ${k + 1}` : "Cúmulo en el punto"}${f && f.name ? ` · ${esc(f.name)}` : ""}</h2><p>Radio de ${rad} alrededor de ${a.center.lat.toFixed(4)}, ${a.center.lon.toFixed(4)}</p></div><button class="btn" id="cuClose" aria-label="Cerrar">Cerrar</button></div>
      <div class="cu-big"><div><span>Suma asegurada</span><b>${money(a.sum)}</b></div><div><span>Riesgos</span><b>${a.n.toLocaleString("es")}</b></div><div><span>De la cartera</span><b>${pct(a.sum, T)}</b></div></div>
      ${a.n ? `<div class="sec"><h3>Por ramo</h3>${bars(a.ramos, a.sum)}</div>
      <div class="sec"><h3>Por cedente</h3>${bars(a.cedentes, a.sum)}</div>
      <div class="sec"><h3>Riesgos más grandes</h3><ol class="cu-top">${a.list.slice(0, 6).map(r => `<li><span>${esc(r.asegurado || r.dir || `Fila ${r.i + 2}`)}<small>${esc(r.ramo)} · ${esc(r.cedente)}</small></span><b>${money(r.suma)}</b></li>`).join("")}</ol></div>`
      : `<p class="cu-note pad">No hay riesgos de la cartera dentro de este radio.</p>`}
      <div class="foot"><button class="btn" id="cuRisk">Ver riesgos naturales del centro</button></div>`;
    $("#cuClose").onclick = () => { box.hidden = true; document.body.classList.remove("cu-detail"); S.sel = null; map.getSource("foco").setData({ type: "FeatureCollection", features: [] }); renderSummary(); };
    $("#cuRisk").onclick = () => { setMode("ubicar"); setPin(a.center.lon, a.center.lat, { fly: true, zoom: 15 }); };
  }

  /* ---------- datos de ejemplo (ficticios) ---------- */
  function sampleRows() {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const zones = [["Guayaquil", -2.17, -79.89, 0.06, 70], ["Samborondón", -2.13, -79.86, 0.025, 25], ["Quito", -0.19, -78.49, 0.05, 35], ["Manta", -0.96, -80.71, 0.03, 15],
      ["Ciudad de Panamá", 8.99, -79.52, 0.05, 30], ["San Salvador", 13.69, -89.22, 0.04, 18], ["Ciudad de Guatemala", 14.62, -90.52, 0.05, 16], ["San José", 9.93, -84.09, 0.04, 14], ["Tegucigalpa", 14.08, -87.2, 0.03, 10]];
    const ramos = ["Incendio y aliadas", "Todo riesgo", "Ramos técnicos", "Transporte"], ced = ["Cedente Alfa", "Cedente Beta", "Cedente Gamma", "Cedente Delta", "Cedente Épsilon"];
    const out = []; let id = 1;
    for (const [n, la, lo, sp, k] of zones) for (let i = 0; i < k; i++) {
      const g = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
      out.push({ "Asegurado": `Riesgo de ejemplo ${String(id++).padStart(3, "0")} (${n})`, "Ramo": ramos[Math.floor(rnd() * ramos.length)], "Cedente": ced[Math.floor(rnd() * ced.length)],
        "Suma asegurada": Math.round(Math.exp(11 + rnd() * 4.5) / 1000) * 1000, "Moneda": "USD", "Latitud": +(la + g() * sp).toFixed(5), "Longitud": +(lo + g() * sp).toFixed(5) });
    }
    return out;
  }
})();
