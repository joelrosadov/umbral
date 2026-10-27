/*
  Umbral · intermediario de datos (Cloudflare Worker)

  Hace dos trabajos para la página de Umbral:
  1. Mapas de riesgo (GeoTIFF): reenvía lecturas parciales (encabezado Range) a
     JRC, ASF, Copernicus y WRI, que no aceptan lecturas desde otras páginas.
     Guarda cada fragmento en caché 30 días.
  2. Pronósticos (JSON): consulta la lluvia pronosticada en MET Norway y el
     caudal de ríos en Open-Meteo, identificándose como pide cada servicio, y
     guarda cada respuesta en caché según su vigencia.

  Solo responde a la página de Umbral y solo consulta los servidores listados.
  Cómo instalarlo: ver README.md, sección "Intermediario de datos".
*/

// Servidores de mapas de riesgo (lecturas parciales de GeoTIFF)
const RASTER_HOSTS = [
  "jeodpp.jrc.ec.europa.eu",                // JRC / GloFAS: inundación de ríos
  "glo-30-hand.s3.us-west-2.amazonaws.com", // ASF: altura sobre el cauce (HAND)
  "copernicus-dem-30m.s3.amazonaws.com",    // Copernicus DEM: elevación
  "aqueduct.wridata.org",                   // WRI Aqueduct: inundación costera
  "wri-projects.s3.amazonaws.com"           // WRI Aqueduct: servidor anterior
];

// Servicios de pronóstico (JSON) y cuánto tiempo guardar sus respuestas
const JSON_HOSTS = {
  "api.met.no": 60 * 30,                    // MET Norway: lluvia pronosticada (CC BY 4.0, uso comercial permitido)
  "flood-api.open-meteo.com": 60 * 60 * 6   // Open-Meteo / GloFAS: caudal de ríos (gratis solo sin fines comerciales)
};

// Páginas que pueden usar este intermediario
const ALLOWED_ORIGINS = [
  "https://joelrosadov.github.io",
  "http://localhost:8000"
];

// Identificación que exige MET Norway
const USER_AGENT = "Umbral/0.3 github.com/joelrosadov/umbral";

const MAX_RANGE_BYTES = 16 * 1024 * 1024;  // 16 MB por lectura
const RASTER_CACHE_SECONDS = 60 * 60 * 24 * 30;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
      "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    const reply = (body, status) => new Response(body, { status, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET" && request.method !== "HEAD") return reply("Método no permitido", 405);
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply("Origen no permitido", 403);

    const params = new URL(request.url).searchParams;
    if (!params.has("url")) return reply("Umbral · intermediario de datos activo (v0.3). Uso: ?url=<dirección permitida>", 200);

    let target;
    try { target = new URL(params.get("url")); } catch (e) { return reply("Parámetro url inválido", 400); }
    if (target.protocol !== "https:") return reply("Solo se permiten direcciones https", 403);

    if (target.hostname in JSON_HOSTS) return proxyJson(target, JSON_HOSTS[target.hostname], cors, ctx, reply);
    if (RASTER_HOSTS.includes(target.hostname)) return proxyRange(request, target, cors, ctx, reply);
    return reply("Servidor de datos no permitido", 403);
  }
};

/* ---------- pronósticos (JSON) ---------- */
async function proxyJson(target, ttl, cors, ctx, reply) {
  const cache = caches.default;
  const cacheKey = new Request(`https://umbral-cache.invalid/json/${encodeURIComponent(target.href)}`);
  const hit = await cache.match(cacheKey);
  if (hit) return withCors(hit, cors, 200);

  const upstream = await fetch(target.href, { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } });
  if (!upstream.ok) return reply(`El servicio respondió ${upstream.status}`, upstream.status === 429 ? 429 : 502);
  const body = await upstream.text();

  // Respeta la vigencia que indica el servicio (encabezado Expires), con un mínimo de 10 minutos
  let seconds = ttl;
  const exp = Date.parse(upstream.headers.get("Expires") || "");
  if (Number.isFinite(exp)) seconds = Math.max(600, Math.round((exp - Date.now()) / 1000));
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${seconds}` });
  ctx.waitUntil(cache.put(cacheKey, new Response(body, { status: 200, headers })));
  return withCors(new Response(body, { status: 200, headers }), cors, 200);
}

/* ---------- mapas de riesgo (lecturas parciales) ---------- */
async function proxyRange(request, target, cors, ctx, reply) {
  const range = request.headers.get("Range");
  if (request.method === "GET") {
    const m = range && range.match(/^bytes=(\d+)-(\d+)$/);
    if (!m) return reply("Se requiere una lectura parcial (Range: bytes=inicio-fin)", 416);
    if (Number(m[2]) - Number(m[1]) + 1 > MAX_RANGE_BYTES) return reply("Lectura demasiado grande", 416);
  }

  // La API de caché no guarda respuestas 206: se guardan como 200 con el estado original en X-Umbral-Status
  const cache = caches.default;
  const cacheKey = new Request(`https://umbral-cache.invalid/raster/${encodeURIComponent(target.href)}/${range || "head"}/${request.method}`);
  const hit = await cache.match(cacheKey);
  if (hit) return withCors(hit, cors, Number(hit.headers.get("X-Umbral-Status")) || 200);

  const upstream = await fetch(target.href, {
    method: request.method,
    headers: range ? { Range: range } : {},
    cf: { cacheTtl: RASTER_CACHE_SECONDS, cacheEverything: true }
  });
  if (!upstream.ok) return reply(`El servidor de datos respondió ${upstream.status}`, upstream.status);

  const body = request.method === "HEAD" ? null : await upstream.arrayBuffer();
  const headers = new Headers();
  for (const h of ["Content-Type", "Content-Range", "Content-Length", "Accept-Ranges", "Last-Modified", "ETag"]) {
    const v = upstream.headers.get(h); if (v) headers.set(h, v);
  }
  headers.set("Cache-Control", `public, max-age=${RASTER_CACHE_SECONDS}`);
  headers.set("X-Umbral-Status", String(upstream.status));
  ctx.waitUntil(cache.put(cacheKey, new Response(body, { status: 200, headers })));
  return withCors(new Response(body, { status: 200, headers }), cors, upstream.status);
}

function withCors(res, cors, status) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  h.delete("X-Umbral-Status");
  return new Response(res.body, { status, headers: h });
}
