/*
  Umbral · intermediario de datos (Cloudflare Worker)

  Permite que la página de Umbral lea los archivos de riesgo (GeoTIFF) alojados
  por JRC, ASF, Copernicus y WRI, que no aceptan lecturas desde otras páginas.
  Solo reenvía lecturas parciales (encabezado Range) hacia una lista cerrada de
  servidores, y solo responde a la página de Umbral. Guarda en caché cada
  fragmento leído para ahorrar consultas.

  Cómo instalarlo: ver README.md, sección "Intermediario de datos".
*/

// Servidores de datos permitidos
const ALLOWED_HOSTS = [
  "jeodpp.jrc.ec.europa.eu",              // JRC / GloFAS: inundación de ríos
  "glo-30-hand.s3.us-west-2.amazonaws.com", // ASF: altura sobre el cauce (HAND)
  "copernicus-dem-30m.s3.amazonaws.com",  // Copernicus DEM: elevación
  "wri-projects.s3.amazonaws.com"         // WRI Aqueduct: inundación costera
];

// Páginas que pueden usar este intermediario
const ALLOWED_ORIGINS = [
  "https://joelrosadov.github.io",
  "http://localhost:8000"
];

const MAX_RANGE_BYTES = 16 * 1024 * 1024; // 16 MB por lectura
const CACHE_SECONDS = 60 * 60 * 24 * 30;  // 30 días: los mapas de riesgo no cambian a diario

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
    if (!params.has("url")) return reply("Umbral · intermediario de datos activo. Uso: ?url=<archivo permitido>", 200);

    let target;
    try { target = new URL(params.get("url")); } catch (e) { return reply("Parámetro url inválido", 400); }
    if (target.protocol !== "https:" || !ALLOWED_HOSTS.includes(target.hostname)) return reply("Servidor de datos no permitido", 403);

    const range = request.headers.get("Range");
    if (request.method === "GET") {
      const m = range && range.match(/^bytes=(\d+)-(\d+)$/);
      if (!m) return reply("Se requiere una lectura parcial (Range: bytes=inicio-fin)", 416);
      if (Number(m[2]) - Number(m[1]) + 1 > MAX_RANGE_BYTES) return reply("Lectura demasiado grande", 416);
    }

    // Caché: la API de caché no guarda respuestas 206, así que se guardan como 200
    // con el estado original en X-Umbral-Status.
    const cache = caches.default;
    const cacheKey = new Request(`https://umbral-cache.invalid/${encodeURIComponent(target.href)}/${range || "head"}/${request.method}`);
    const hit = await cache.match(cacheKey);
    if (hit) return withCors(hit, cors, Number(hit.headers.get("X-Umbral-Status")) || 200);

    const upstream = await fetch(target.href, {
      method: request.method,
      headers: range ? { Range: range } : {},
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
    });
    if (!upstream.ok) return reply(`El servidor de datos respondió ${upstream.status}`, upstream.status);

    const body = request.method === "HEAD" ? null : await upstream.arrayBuffer();
    const headers = new Headers();
    for (const h of ["Content-Type", "Content-Range", "Content-Length", "Accept-Ranges", "Last-Modified", "ETag"]) {
      const v = upstream.headers.get(h); if (v) headers.set(h, v);
    }
    headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
    headers.set("X-Umbral-Status", String(upstream.status));
    ctx.waitUntil(cache.put(cacheKey, new Response(body, { status: 200, headers })));
    return withCors(new Response(body, { status: 200, headers }), cors, upstream.status);
  }
};

function withCors(res, cors, status) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  h.delete("X-Umbral-Status");
  return new Response(res.body, { status, headers: h });
}
