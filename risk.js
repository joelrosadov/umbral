/* Umbral — fase 2: lectura de capas de riesgo reales para un punto.
   Lee el valor exacto del punto en archivos GeoTIFF globales, a través del
   intermediario de Cloudflare (cloudflare/worker.js).

   Capas:
   - Inundación de ríos: JRC / Copernicus GloFAS v2.1, profundidad para 1 en 10, 100 y 500 años, ~90 m
   - Altura sobre el cauce (HAND): ASF, derivado de Copernicus DEM, 30 m, CC0
   - Elevación: Copernicus DEM GLO-30, 30 m
   - Inundación costera: WRI Aqueduct Floods, marejada 1 en 100 años, ~1 km */

(function () {
  const PROXY = (() => {
    let p = "";
    try { p = localStorage.getItem("umbralProxy") || ""; } catch (e) {}
    return (p || "https://umbral-datos.joelrosadov.workers.dev").replace(/\/+$/, "");
  })();
  const via = u => `${PROXY}/?url=${encodeURIComponent(u)}`;

  /* Mosaicos del JRC: nombre = esquina superior izquierda, celdas de 10°. Lista oficial del servidor JRC (IDs 1–155). */
  const JRC_TILES = "ID1_N70_W180 ID2_N80_W170 ID3_N70_W170 ID4_N60_W170 ID5_N80_W160 ID6_N70_W160 ID7_N60_W160 ID8_N80_W150 ID9_N70_W150 ID10_N60_W150 ID11_N80_W140 ID12_N70_W140 ID13_N60_W140 ID14_N80_W130 ID15_N70_W130 ID16_N60_W130 ID17_N50_W130 ID18_N40_W130 ID19_N80_W120 ID20_N70_W120 ID21_N60_W120 ID22_N50_W120 ID23_N40_W120 ID24_N30_W120 ID25_N80_W110 ID26_N70_W110 ID27_N60_W110 ID28_N50_W110 ID29_N40_W110 ID30_N30_W110 ID31_N20_W110 ID32_N90_W100 ID33_N80_W100 ID34_N70_W100 ID35_N60_W100 ID36_N50_W100 ID37_N40_W100 ID38_N30_W100 ID39_N20_W100 ID40_N90_W90 ID41_N80_W90 ID42_N70_W90 ID43_N60_W90 ID44_N50_W90 ID45_N40_W90 ID46_N30_W90 ID47_N20_W90 ID48_N10_W90 ID49_N0_W90 ID50_N90_W80 ID51_N80_W80 ID52_N70_W80 ID53_N60_W80 ID54_N50_W80 ID55_N40_W80 ID56_N30_W80 ID57_N20_W80 ID58_N10_W80 ID59_N0_W80 ID60_S10_W80 ID61_S20_W80 ID62_S30_W80 ID63_S40_W80 ID64_S50_W80 ID65_N90_W70 ID66_N80_W70 ID67_N70_W70 ID68_N60_W70 ID69_N50_W70 ID70_N20_W70 ID71_N10_W70 ID72_N0_W70 ID73_S10_W70 ID74_S20_W70 ID75_S30_W70 ID76_S40_W70 ID77_S50_W70 ID78_N80_W60 ID79_N70_W60 ID80_N60_W60 ID81_N50_W60 ID82_N10_W60 ID83_N0_W60 ID84_S10_W60 ID85_S20_W60 ID86_S30_W60 ID87_N80_W50 ID88_N70_W50 ID89_N60_W50 ID90_N10_W50 ID91_N0_W50 ID92_S10_W50 ID93_S20_W50 ID94_N80_W40 ID95_N70_W40 ID96_N0_W40 ID97_S10_W40 ID98_N80_W30 ID99_N70_W30 ID100_N80_W20 ID101_N70_W20 ID102_N60_W20 ID103_N30_W20 ID104_N20_W20 ID105_N10_W20 ID106_N60_W10 ID107_N50_W10 ID108_N40_W10 ID109_N30_W10 ID110_N20_W10 ID111_N10_W10 ID112_N70_W0 ID113_N60_W0 ID114_N50_W0 ID115_N40_W0 ID116_N30_W0 ID117_N20_W0 ID118_N10_W0 ID119_N0_W0 ID120_N70_E10 ID121_N60_E10 ID122_N50_E10 ID123_N40_E10 ID124_N30_E10 ID125_N20_E10 ID126_N10_E10 ID127_N0_E10 ID128_S10_E10 ID129_S20_E10 ID130_S30_E10 ID131_N80_E20 ID132_N70_E20 ID133_N60_E20 ID134_N50_E20 ID135_N40_E20 ID136_N30_E20 ID137_N20_E20 ID138_N10_E20 ID139_N0_E20 ID140_S10_E20 ID141_S20_E20 ID142_S30_E20 ID143_N80_E30 ID144_N70_E30 ID145_N60_E30 ID146_N50_E30 ID147_N40_E30 ID148_N30_E30 ID149_N20_E30 ID150_N10_E30 ID151_N0_E30 ID152_S10_E30 ID153_S20_E30 ID154_S30_E30 ID155_N70_E40"
    .split(" ").reduce((m, s) => { const i = s.indexOf("_"); m[s.slice(i + 1)] = s; return m; }, {});
  const JRC_BASE = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/CEMS-GLOFAS/flood_hazard/";
  function jrcUrl(lon, lat, rp) {
    const top = Math.floor(lat / 10) * 10 + 10, left = Math.floor(lon / 10) * 10;
    const la = top > 0 ? `N${top}` : top === 0 ? "N0" : `S${-top}`;
    const lo = left < 0 ? `W${-left}` : left === 0 ? "W0" : `E${left}`;
    const id = JRC_TILES[`${la}_${lo}`];
    return id ? `${JRC_BASE}RP${rp}/${id}_RP${rp}_depth.tif` : null;
  }

  const pad = (n, w) => String(n).padStart(w, "0");
  function cop(lon, lat) {
    const fy = Math.floor(lat), fx = Math.floor(lon);
    return `Copernicus_DSM_COG_10_${fy < 0 ? "S" : "N"}${pad(Math.abs(fy), 2)}_00_${fx < 0 ? "W" : "E"}${pad(Math.abs(fx), 3)}_00`;
  }
  const handUrl = (lon, lat) => `https://glo-30-hand.s3.us-west-2.amazonaws.com/v1/2021/${cop(lon, lat)}_HAND.tif`;
  const demUrl = (lon, lat) => { const n = cop(lon, lat); return `https://copernicus-dem-30m.s3.amazonaws.com/${n}_DEM/${n}_DEM.tif`; };
  const wbmUrl = (lon, lat) => { const n = cop(lon, lat); return `https://copernicus-dem-30m.s3.amazonaws.com/${n}_DEM/AUXFILES/${n}_WBM.tif`; };
  const AQ = "https://aqueduct.wridata.org/AqueductFloods20/";
  const coastUrl = rp => `${AQ}inuncoast_historical_nosub_hist_rp${pad(rp, 4)}_0.tif`;

  /* Lectura de un punto (y su vecindario) en un GeoTIFF remoto */
  const images = new Map();
  function openImage(url) {
    if (!images.has(url)) {
      const p = GeoTIFF.fromUrl(via(url), { allowFullFile: false, cacheSize: 200 }).then(t => t.getImage());
      p.catch(() => images.delete(url));
      images.set(url, p);
    }
    return images.get(url);
  }
  const timeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("tiempo agotado")), ms))]);
  async function sample(url, lon, lat, radius = 1, ms = 40000, keep = false) {
    if (!url) return { status: "nocover" };
    try {
      const img = await timeout(openImage(url), ms);
      const [minX, minY, maxX, maxY] = img.getBoundingBox();
      const w = img.getWidth(), h = img.getHeight();
      const px = Math.floor((lon - minX) / (maxX - minX) * w), py = Math.floor((maxY - lat) / (maxY - minY) * h);
      if (px < 0 || py < 0 || px >= w || py >= h) return { status: "nocover" };
      const x0 = Math.max(0, px - radius), y0 = Math.max(0, py - radius), x1 = Math.min(w, px + radius + 1), y1 = Math.min(h, py + radius + 1);
      const data = await timeout(img.readRasters({ window: [x0, y0, x1, y1] }), ms);
      const nd = img.getGDALNoData();
      const ok = x => Number.isFinite(x) && x > -1e30 && x < 1e30 && (nd === null || x !== nd);
      const arr = Array.from(data[0]);
      const c = arr[(py - y0) * (x1 - x0) + (px - x0)];
      const valid = arr.filter(ok);
      const cellM = (maxX - minX) / w * 111320 * Math.cos(lat * Math.PI / 180);
      return { status: "ok", value: ok(c) ? c : null, max: valid.length ? Math.max(...valid) : null, min: valid.length ? Math.min(...valid) : null, cellM,
        grid: keep ? { arr: arr.map(x => ok(x) ? x : NaN), w: x1 - x0, h: y1 - y0, cx: px - x0, cy: py - y0 } : null };
    } catch (e) {
      return { status: "error", error: String(e.message || e) };
    }
  }

  /* Interpretación */
  const LEVELS = ["Bajo", "Medio", "Alto", "Muy alto"];
  const depthOf = s => s && s.status === "ok" ? Math.max(s.value || 0, 0) : 0;
  const nearOf = s => s && s.status === "ok" ? Math.max(s.max || 0, 0) : 0;

  function fluvialLevel(r) {
    const d10 = depthOf(r.fl10), d100 = depthOf(r.fl100), d500 = depthOf(r.fl500);
    const n100 = nearOf(r.fl100);
    const hand = r.hand && r.hand.status === "ok" && r.hand.value !== null ? r.hand.value : null;
    const jrcKnown = ["fl10", "fl100", "fl500"].some(k => r[k] && (r[k].status === "ok" || r[k].status === "nocover"));
    const jrcOk = r.fl100 && r.fl100.status === "ok";
    if (!jrcOk && hand === null) return { lvl: null, why: jrcKnown ? "Este lugar está fuera de la cobertura de los mapas de crecidas disponibles." : "No pudimos leer los mapas de crecidas en este momento. Intenta de nuevo en unos segundos." };
    let lvl = 0, why = "";
    if (d10 > 0.05) { lvl = 3; why = `Se inunda incluso en crecidas frecuentes (1 en 10 años), con unos ${fmt(d10)} m.`; }
    else if (d100 > 0.5) { lvl = 2; why = `En una crecida fuerte (1 en 100 años) el agua llegaría a unos ${fmt(d100)} m.`; }
    else if (d100 > 0.05) { lvl = 1; why = `En una crecida fuerte (1 en 100 años) el agua llegaría a unos ${fmt(d100)} m.`; }
    else if (d500 > 0.05) { lvl = 1; why = `Solo se inundaría en una crecida extrema (1 en 500 años), con unos ${fmt(d500)} m.`; }
    else if (n100 > 0.05) { lvl = 1; why = `El punto no aparece inundado, pero a menos de 150 m sí, con hasta ${fmt(n100)} m en una crecida de 1 en 100 años.`; }
    if (hand !== null) {
      let hl = hand < 1 ? 2 : hand < 3 ? 1 : 0;
      const handTxt = `El terreno está ${hand < 0.5 ? "prácticamente al nivel" : `a ${fmt(hand)} m por encima`} del cauce más cercano.`;
      if (hl > lvl) { lvl = hl; why = (why ? why + " " : "") + handTxt + (lvl >= 2 ? " Eso lo hace vulnerable incluso a desbordes de quebradas pequeñas." : ""); }
      else why = (why ? why + " " : "") + handTxt;
    }
    if (!why) why = "No está en una zona inundable por ríos según los mapas disponibles.";
    return { lvl, why };
  }
  function coastalLevel(r) {
    const s = r.coast100;
    if (!s) return null;
    if (s.status !== "ok") return { lvl: null, why: s.status === "nocover" ? "Fuera de la cobertura del mapa costero." : "No pudimos leer el mapa costero en este momento." };
    const d = depthOf(s), n = nearOf(s);
    const elev = r.dem && r.dem.status === "ok" && r.dem.value !== null ? r.dem.value : null;
    if (d > 1) return { lvl: 3, why: `Una marejada fuerte (1 en 100 años) cubriría el terreno con unos ${fmt(d)} m de agua.` };
    if (d > 0.05) return { lvl: 2, why: `Una marejada fuerte (1 en 100 años) cubriría el terreno con unos ${fmt(d)} m de agua.` };
    if (n > 0.05) return { lvl: 1, why: `El punto no se inunda, pero la zona de alrededor (~1 km) sí, con hasta ${fmt(n)} m.` };
    if (elev !== null && elev < 3) return { lvl: 1, why: `El mapa costero no lo marca, pero el terreno está a solo ${fmt(elev)} m sobre el nivel del mar.` };
    return { lvl: 0, why: "No está expuesto a marejadas según el mapa costero." };
  }
  /* Encharcamiento por lluvia: indicador a partir del relieve (Copernicus DEM 30 m) y del HAND.
     - Hondonada: cuánto más bajo está el punto que el terreno típico a su alrededor (~250 m).
     - Pendiente: si el terreno es plano, el agua no escurre.
     - Cercanía al nivel del cauce: drena mal cuando los ríos y quebradas suben. */
  function terrainOf(r) {
    const s = r.dem;
    if (!s || s.status !== "ok" || !s.grid || s.value === null) return null;
    const { arr, w, h, cx, cy } = s.grid, c = s.value, cell = s.cellM || 30;
    const ring = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dd = Math.hypot(x - cx, y - cy);
      if (dd >= 2 && Number.isFinite(arr[y * w + x])) ring.push(arr[y * w + x]);
    }
    if (ring.length < 20) return null;
    ring.sort((a, b) => a - b);
    const q = p => ring[Math.min(ring.length - 1, Math.floor(p * ring.length))];
    const depression = q(0.25) - c;          // positivo: el punto está más bajo que el terreno de alrededor
    const at = (x, y) => arr[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
    const gx = (at(cx + 1, cy) - at(cx - 1, cy)) / (2 * cell), gy = (at(cx, cy + 1) - at(cx, cy - 1)) / (2 * cell);
    const slope = Number.isFinite(gx + gy) ? Math.hypot(gx, gy) * 100 : null;   // en %
    return { depression, slope };
  }
  function pluvialLevel(r) {
    const t = terrainOf(r);
    const hand = r.hand && r.hand.status === "ok" && r.hand.value !== null ? r.hand.value : null;
    if (!t) return { lvl: null, why: r.dem && r.dem.status !== "ok" ? "No pudimos leer el relieve del terreno en este momento." : "No hay datos de relieve para este punto." };
    let pts = 0; const why = [];
    if (t.depression > 1.5) { pts += 2; why.push(`está ${fmt(t.depression)} m más bajo que el terreno a su alrededor, así que el agua tiende a juntarse ahí`); }
    else if (t.depression > 0.5) { pts += 1; why.push(`está algo más bajo que su entorno (${fmt(t.depression)} m)`); }
    if (t.slope !== null && t.slope < 1) { pts += 1; why.push("el terreno es casi plano y el agua escurre despacio"); }
    else if (t.slope !== null && t.slope > 8) { pts -= 1; why.push("el terreno tiene pendiente y el agua escurre rápido"); }
    if (hand !== null && hand < 2) { pts += 1; why.push("está cerca del nivel del cauce y drena mal cuando suben los ríos"); }
    const lvl = Math.max(0, Math.min(3, pts >= 4 ? 3 : pts === 3 ? 2 : pts === 2 ? 1 : 0));
    const text = why.length ? `${why[0].charAt(0).toUpperCase()}${why[0].slice(1)}${why.length > 1 ? "; " + why.slice(1).join("; ") : ""}.` : "El punto no está en una hondonada y el agua puede escurrir.";
    return { lvl, why: text, terrain: t };
  }
  const fmt = v => Number(v).toLocaleString("es", { maximumFractionDigits: v < 10 ? 1 : 0 });

  /* Análisis completo con avances parciales */
  function analyze(lon, lat, onUpdate) {
    const r = {};
    const jobs = {
      fl10: () => sample(jrcUrl(lon, lat, 10), lon, lat),
      fl100: () => sample(jrcUrl(lon, lat, 100), lon, lat, 2),
      fl500: () => sample(jrcUrl(lon, lat, 500), lon, lat),
      hand: () => sample(handUrl(lon, lat), lon, lat, 0),
      dem: () => sample(demUrl(lon, lat), lon, lat, 8, 40000, true),
      coast100: () => sample(coastUrl(100), lon, lat, 1),
      wbm: () => sample(wbmUrl(lon, lat), lon, lat, 0)
    };
    const all = Object.entries(jobs).map(([k, fn]) => fn().then(v => { r[k] = v; onUpdate(summarize(r)); }));
    return Promise.all(all).then(() => summarize(r, true));
  }
  function summarize(r, done = false) {
    done = done || Object.keys(r).length === 7;
    const keys = ["fl10", "fl100", "fl500", "hand", "dem", "coast100"];
    const loaded = keys.filter(k => r[k]).length;
    const fluvReady = r.fl10 && r.fl100 && r.fl500 && r.hand;
    const pluv = r.dem && r.hand ? pluvialLevel(r) : null;
    const fluv = fluvReady ? fluvialLevel(r) : null;
    const coast = r.coast100 ? coastalLevel(r) : null;
    const parts = [fluv && { k: "rio", ...fluv }, pluv && { k: "lluvia", ...pluv }, coast && { k: "mar", ...coast }].filter(Boolean);
    const known = parts.filter(p => p.lvl !== null);
    const top = known.length ? Math.max(...known.map(p => p.lvl)) : null;
    const failedAll = done && !known.length;
    return { raw: r, loaded, total: keys.length, done: done || loaded === keys.length, fluv, coast, top, failedAll, partial: known.length < 3, pluv, parts, LEVELS };
  }

  window.Risk = { analyze, LEVELS, sources: { jrcUrl, handUrl, demUrl, coastUrl, wbmUrl } };
})();
