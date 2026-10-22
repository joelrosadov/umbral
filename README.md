# Umbral

Umbral muestra en un mapa los riesgos naturales de cualquier lugar o edificio del mundo: inundación por ríos, inundación desde el mar, terremotos y volcanes. Usa solo datos abiertos y servicios gratuitos.

## Estado

| Fase | Qué incluye | Estado |
| --- | --- | --- |
| 1 | Mapa mundial a nivel de calle, edificios, búsqueda de direcciones, elevación del terreno, vista 3D y relieve | Listo |
| 2 | Riesgo real por punto: inundación fluvial (JRC/GloFAS), costera (WRI Aqueduct) y altura sobre el cauce más cercano (HAND) | Pendiente |
| 3 | Refinamiento por edificio y amenaza sísmica por país | Pendiente |
| 4 | Carga de carteras y API | Pendiente |

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
- `vendor/`: MapLibre GL JS 4.7.1, incluido para no depender de un CDN.

## Fuentes de datos y servicios

| Uso | Servicio | Licencia o condición |
| --- | --- | --- |
| Mapa base y edificios | [OpenFreeMap](https://openfreemap.org), con datos de [OpenStreetMap](https://www.openstreetmap.org/copyright) y OpenMapTiles | Gratis, sin clave, uso comercial permitido; datos ODbL |
| Elevación y relieve | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | Gratis con atribución a sus fuentes |
| Búsqueda | [Photon](https://photon.komoot.io) | Servicio público gratuito, uso moderado |
| Dirección del punto | [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) | Máximo una consulta por segundo; la app ya respeta ese límite |
| Librería de mapas | [MapLibre GL JS](https://maplibre.org) | BSD-3-Clause |

Cuando el tráfico crezca, Photon y Nominatim deben reemplazarse por una instancia propia o un proveedor, porque los servicios públicos tienen límites de uso.

## Aviso

Umbral es un prototipo. Sus resultados no reemplazan un estudio técnico ni una inspección del inmueble.
