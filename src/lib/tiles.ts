/**
 * Basemaps for every Leaflet map in the app. Two, switchable from the header
 * (src/lib/basemap.ts holds the preference):
 *
 * **night** (default) — NASA's **Black Marble**: Earth at night from the VIIRS
 * instrument (2016 composite), served by NASA GIBS. Free, keyless, public
 * domain. City lights ARE the map: metros glow, highways trace faint lines
 * between them, and the dark in between is dark. That is the maptap.gg feel
 * the game is going for, and it is a fair hint — a college town is usually a
 * modest glow near a bigger one, never labelled. GIBS serves this layer to
 * zoom 8 (~600 m/px); Leaflet upscales the level-8 tiles to MAX_ZOOM so
 * players can still fine-tune a pin (blurry, but a pin at 25 km tolerance
 * doesn't need street detail).
 *
 * **satellite** — EOX's **Sentinel-2 cloudless** mosaic (EOxCloudless): a
 * daytime true-colour composite of Copernicus Sentinel-2 imagery, served from
 * EOX's WMTS, keyless, native all the way to our zoom cap. Licence: CC
 * BY-NC-SA 4.0 for non-commercial use, which this free game is; the credit
 * line below is the one EOX's capabilities document asks for and MUST stay
 * next to the map (it's the Leaflet attribution) and in the footer. Bump the
 * year in SATELLITE_YEAR when EOX publishes a new mosaic — the credit updates
 * with it.
 *
 * State outlines are drawn separately as a vector layer (src/data/us-states
 * .json) because neither imagery has borders.
 *
 * (History: CARTO light_nolabels was the first choice but now requires an API
 * key; Esri's Light Gray Canvas base was the stand-in until the night map.)
 */

import L from 'leaflet'
import { log } from './log'
import type { Basemap } from './basemap'

/** Deepest zoom a player can reach. 10 ≈ 150 m/px: county scale. */
export const MAX_ZOOM = 10
/** Deepest zoom GIBS actually serves for the night layer; Leaflet upscales beyond it. */
export const MAX_NATIVE_ZOOM = 8

/** The EOxCloudless mosaic year in use (layer id + credit line). */
export const SATELLITE_YEAR = 2025

export interface BasemapDef {
  /** Short label for the header toggle / aria text. */
  label: string
  url: string
  /** HTML; rendered by Leaflet's attribution control. */
  attribution: string
  /** Plain-text credit for the footer. */
  credit: string
  maxNativeZoom: number
}

export const BASEMAPS: Record<Basemap, BasemapDef> = {
  night: {
    label: 'night',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
    // A credit, not a ©: NASA imagery is public domain. GIBS asks to be named.
    attribution:
      'Imagery: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> / VIIRS Black Marble',
    credit: 'NASA GIBS / VIIRS Black Marble (public domain)',
    maxNativeZoom: MAX_NATIVE_ZOOM,
  },
  satellite: {
    label: 'satellite',
    url: `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${SATELLITE_YEAR}_3857/default/g/{z}/{y}/{x}.jpg`,
    attribution:
      `<a href="https://cloudless.eox.at">EOxCloudless</a> by EOX IT Services GmbH ` +
      `(Contains modified Copernicus Sentinel data ${SATELLITE_YEAR}), ` +
      `<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>`,
    credit: `EOxCloudless (https://cloudless.eox.at) by EOX IT Services GmbH, contains modified Copernicus Sentinel data ${SATELLITE_YEAR}, CC BY-NC-SA 4.0`,
    maxNativeZoom: MAX_ZOOM,
  },
}

/** Kept for callers that only ever wanted the night credit. */
export const TILE_ATTRIBUTION = BASEMAPS.night.attribution

export function makeTileLayer(basemap: Basemap = 'night'): L.TileLayer {
  const def = BASEMAPS[basemap]
  log.debug('tiles', `tile provider: ${basemap}`)
  return L.tileLayer(def.url, {
    attribution: def.attribution,
    maxNativeZoom: def.maxNativeZoom,
    maxZoom: MAX_ZOOM,
    // (The dark background behind loading tiles comes from `.map-container`
    // in index.css.)
  })
}
