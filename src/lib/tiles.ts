/**
 * The basemap for every Leaflet map in the app: NASA's **Black Marble** —
 * Earth at night from the VIIRS instrument (2016 composite), served by NASA
 * GIBS. Free, keyless, public domain. City lights ARE the map: metros glow,
 * highways trace faint lines between them, and the dark in between is dark.
 * That is the maptap.gg feel the game is going for, and it is a fair hint —
 * a college town is usually a modest glow near a bigger one, never labelled.
 *
 * GIBS serves this layer to zoom 8 (~600 m/px); Leaflet upscales the level-8
 * tiles to MAX_ZOOM so players can still fine-tune a pin (blurry, but a pin
 * at 25 km tolerance doesn't need street detail). State outlines are drawn
 * separately as a vector layer (src/data/us-states.json) because night
 * imagery has no borders at all.
 *
 * (History: CARTO light_nolabels was the first choice but now requires an API
 * key; Esri's Light Gray Canvas base was the stand-in until the night map.)
 */

import L from 'leaflet'
import { log } from './log'

const GIBS_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png'
export const TILE_ATTRIBUTION =
  'Imagery &copy; <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> — VIIRS Black Marble'

/** Deepest zoom a player can reach. 10 ≈ 150 m/px: county scale. */
export const MAX_ZOOM = 10
/** Deepest zoom GIBS actually serves for this layer; Leaflet upscales beyond it. */
export const MAX_NATIVE_ZOOM = 8

export function makeTileLayer(): L.TileLayer {
  log.debug('tiles', 'tile provider: nasa gibs viirs black marble')
  return L.tileLayer(GIBS_URL, {
    attribution: TILE_ATTRIBUTION,
    maxNativeZoom: MAX_NATIVE_ZOOM,
    maxZoom: MAX_ZOOM,
    // Night imagery is black at the edges of the world; a dark tile
    // background keeps the pre-load flash from flashing white.
    className: 'night-tiles',
  })
}
