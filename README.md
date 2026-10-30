# Umbral

Umbral muestra en un mapa los riesgos naturales de cualquier lugar o edificio del mundo: inundación por ríos, inundación desde el mar, terremotos y volcanes. Usa solo datos abiertos y servicios gratuitos.

## Estado

| Fase | Qué incluye | Estado |
| --- | --- | --- |
| 1 | Mapa mundial a nivel de calle, edificios, búsqueda de direcciones, elevación del terreno, vista 3D y relieve | Listo |
| 2 | Riesgo real por punto: inundación fluvial (JRC/GloFAS), costera (WRI Aqueduct), encharcamiento por lluvia (relieve 30 m + HAND), y pronóstico de lluvia y caudal en tiempo real | En prueba |
| 3 | Refinamiento por edificio y amenaza sísmica por país | Pendiente |
| 4 | Módulo de cúmulos: carga de cartera (Excel/CSV), mapa de concentración, mayores cúmulos por radio y detalle por ramo y cedente | En prueba |

## Cómo publicarlo gratis con GitHub Pages

1. En este repositorio, abre **Settings → Pages**.
2. En **Build and deployment**, elige **Deploy from a branch**.
3. Selecciona la rama **main** y la carpeta **/ (root)**, y pulsa **Save**.
4. Espera uno o dos minutos. La página queda en `https://joelrosadov.github.io/umbral/`.

No hace falta instalar nada: es una página estática sin paso de compilación.

## Probarlo en tu computadora

Desde la carpeta del proyecto:

```
python3 -m http.server 8000
```

y abre `http://localhost:8000`.

## Estructura

- `index.html`: estructura de la página.
- `styles.css`: estilos, con modo claro y oscuro.
- `app.js`: mapa, búsqueda, selección de edificios y ficha del lugar.
- `risk.js`: lectura de las capas de riesgo y cálculo del nivel de riesgo.
- `cumulos.js`: módulo de cúmulos de riesgo; la cartera se procesa solo en el navegador.
- `calibracion.html`: página para calibrar el indicador de anegamiento contra sectores conocidos.
- `forecast.js`: pronóstico de lluvia (MET Norway) y de caudal del río más cercano (GloFAS vía Open-Meteo).
- `prueba.html`: página de diagnóstico de las fuentes de datos.
- `cloudflare/worker.js`: intermediario de datos.
- `vendor/`: MapLibre GL JS 4.7.1, geotiff.js 2.1.3 y SheetJS 0.18.5, incluidos para no depender de un CDN.

## Intermediario de datos (Cloudflare Worker)

Los servidores que alojan los mapas de riesgo no permiten que otra página lea sus archivos directamente. El archivo `cloudflare/worker.js` es un intermediario gratuito que reenvía esas lecturas solo para esta página y guarda en caché lo que lee.

1. Crea una cuenta gratuita en [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
2. En el panel, entra a **Compute (Workers) → Workers & Pages**, pulsa **Create application** y elige **Start with Hello World!**.
3. Ponle de nombre `umbral-datos` y pulsa **Deploy**.
4. Pulsa **Edit code**, borra el contenido, pega el de `cloudflare/worker.js` y pulsa **Deploy**.
5. Copia la dirección del worker, por ejemplo `https://umbral-datos.tu-usuario.workers.dev`.

El plan gratuito de Workers incluye 100.000 consultas al día.

## Fuentes de datos y servicios

| Uso | Servicio | Licencia o condición |
| --- | --- | --- |
| Mapa base y edificios | [OpenFreeMap](https://openfreemap.org), con datos de [OpenStreetMap](https://www.openstreetmap.org/copyright) y OpenMapTiles | Gratis, sin clave, uso comercial permitido; datos ODbL |
| Elevación y relieve | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | Gratis con atribución a sus fuentes |
| Búsqueda | [Photon](https://photon.komoot.io) | Servicio público gratuito, uso moderado |
| Dirección del punto | [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) | Máximo una consulta por segundo; la app ya respeta ese límite |
| Inundación de ríos | [JRC / Copernicus GloFAS](https://data.jrc.ec.europa.eu/collection/id-0054) | Producto Copernicus libre y abierto |
| Altura sobre el cauce | [ASF Global HAND 30 m](https://registry.opendata.aws/glo-30-hand/) | CC0 |
| Elevación 30 m | [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/) | Libre con atribución a DLR / Airbus |
| Inundación costera | [WRI Aqueduct Floods](https://www.wri.org/data/aqueduct-floods-hazard-maps) | CC BY 4.0 |
| Pronóstico de lluvia | [MET Norway Locationforecast](https://api.met.no/doc/TermsOfService) | CC BY 4.0, uso comercial permitido |
| Pronóstico de caudal | [Open-Meteo Flood API](https://open-meteo.com/en/terms) (datos GloFAS) | Gratis solo sin fines comerciales: contratar plan o reemplazar antes de vender |
| Librería de mapas | [MapLibre GL JS](https://maplibre.org) | BSD-3-Clause |

Cuando el tráfico crezca, Photon y Nominatim deben reemplazarse por una instancia propia o un proveedor, porque los servicios públicos tienen límites de uso.

## Aviso

Umbral es un prototipo. Sus resultados no reemplazan un estudio técnico ni una inspección del inmueble.
