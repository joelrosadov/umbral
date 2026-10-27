/* Umbral — pronóstico en tiempo real para un punto.
   - Lluvia: MET Norway Locationforecast 2.0 (CC BY 4.0, uso comercial permitido), próximos ~9 días.
   - Caudal del río: Open-Meteo Flood API con datos de GloFAS.
     AVISO: Open-Meteo es gratis solo sin fines comerciales. Antes de ofrecer Umbral
     comercialmente, contratar su plan de pago o reemplazar esta fuente. */

(function () {
  const PROXY = (() => {
    let p = "";
    try { p = localStorage.getItem("umbralProxy") || ""; } catch (e) {}
    return (p || "https://umbral-datos.joelrosadov.workers.dev").replace(/\/+$/, "");
  })();
  const via = u => `${PROXY}/?url=${encodeURIComponent(u)}`;
  const r4 = v => Number(v).toFixed(4);   // MET Norway pide máximo 4 decimales
  const getJson = async (url, ms = 25000) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(via(url), { signal: ctl.signal });
      if (!res.ok) throw new Error(`respuesta ${res.status}`);
      return await res.json();
    } finally { clearTimeout(t); }
  };

  /* Hora local aproximada del punto (zona horaria por longitud) */
  const offsetH = lon => Math.round(lon / 15);
  const dayKey = (ms, off) => new Date(ms + off * 3600e3).toISOString().slice(0, 10);

  /* ---------- lluvia ---------- */
  async function rain(lon, lat) {
    const data = await getJson(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${r4(lat)}&lon=${r4(lon)}`);
    const ts = data.properties.timeseries;
    const hourly = []; // { t (ms), mm, hours }
    let cursor = 0;
    for (const s of ts) {
      const t = Date.parse(s.time);
      if (t < cursor) continue;
      const d1 = s.data.next_1_hours, d6 = s.data.next_6_hours;
      if (d1 && d1.details && d1.details.precipitation_amount != null) { hourly.push({ t, mm: d1.details.precipitation_amount, hours: 1 }); cursor = t + 3600e3; }
      else if (d6 && d6.details && d6.details.precipitation_amount != null) { hourly.push({ t, mm: d6.details.precipitation_amount, hours: 6 }); cursor = t + 6 * 3600e3; }
    }
    const off = offsetH(lon);
    const days = new Map();
    for (const h of hourly) {
      const k = dayKey(h.t, off);
      const d = days.get(k) || { date: k, mm: 0, maxHour: 0, partial: false };
      d.mm += h.mm; if (h.hours === 1) d.maxHour = Math.max(d.maxHour, h.mm); else d.coarse = true;
      days.set(k, d);
    }
    const list = [...days.values()].slice(0, 9);
    // lluvia de las próximas 24 h (ventana móvil sobre los primeros pasos horarios)
    const now = Date.now();
    const next24 = hourly.filter(h => h.t >= now - 3600e3 && h.t < now + 24 * 3600e3).reduce((a, h) => a + h.mm, 0);
    const maxDay = list.reduce((a, d) => Math.max(a, d.mm), 0);
    const maxHour = hourly.filter(h => h.hours === 1).reduce((a, h) => Math.max(a, h.mm), 0);
    const updated = data.properties.meta && data.properties.meta.updated_at;
    // Niveles de alerta por lluvia acumulada en un día y por intensidad horaria
    let lvl = maxDay >= 100 ? 3 : maxDay >= 50 ? 2 : maxDay >= 20 ? 1 : 0;
    if (maxHour >= 30) lvl = Math.max(lvl, 2);
    const peak = list.reduce((a, d) => d.mm > (a ? a.mm : -1) ? d : a, null);
    return { days: list, next24, maxDay, maxHour, peak, lvl, updated };
  }

  /* ---------- caudal del río (GloFAS vía Open-Meteo) ---------- */
  async function river(lon, lat) {
    const base = `https://flood-api.open-meteo.com/v1/flood?latitude=${r4(lat)}&longitude=${r4(lon)}&daily=river_discharge`;
    const [fc, hist] = await Promise.all([
      getJson(`${base}&past_days=2&forecast_days=10`),
      getJson(`${base}&start_date=2000-01-01&end_date=2022-07-31`, 40000)
    ]);
    const h = (hist.daily.river_discharge || []).filter(v => v != null).sort((a, b) => a - b);
    const f = (fc.daily.river_discharge || []).map((v, i) => ({ date: fc.daily.time[i], q: v })).filter(x => x.q != null);
    if (!h.length || !f.length || h[h.length - 1] < 1) return { none: true };
    const q = p => h[Math.min(h.length - 1, Math.floor(p * h.length))];
    const p50 = q(0.5), p90 = q(0.9), p99 = q(0.99), max = h[h.length - 1];
    const today = new Date().toISOString().slice(0, 10);
    const ahead = f.filter(x => x.date >= today);
    const peak = ahead.reduce((a, x) => x.q > (a ? a.q : -1) ? x : a, null);
    const pct = peak ? h.filter(v => v <= peak.q).length / h.length * 100 : null;
    const lvl = !peak ? null : peak.q >= p99 ? 3 : peak.q >= p90 ? 2 : peak.q >= p50 * 1.5 ? 1 : 0;
    return { series: f, peak, p50, p90, p99, max, pct, lvl };
  }

  function forecast(lon, lat) {
    return {
      rain: rain(lon, lat).catch(e => ({ error: String(e.message || e) })),
      river: river(lon, lat).catch(e => ({ error: String(e.message || e) }))
    };
  }
  window.Forecast = { forecast };
})();
