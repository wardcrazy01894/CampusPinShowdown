/**
 * The basemap for every Leaflet map in the app. A college-town game wants a
 * CLEAN map — state borders and coastlines are fair, city labels are not — so
 * the default is Esri's **World Light Gray Canvas BASE** layer: free, keyless
 * (same ArcGIS Online service KnowYourCity's satellite layer uses), with
 * administrative boundaries and water but NO place labels (those live in the
 * separate `…_Gray_Reference` layer, which we deliberately don't add).
 * Attribution is required and rendered by Leaflet's attribution control.
 *
 * (CARTO's `light_nolabels` raster tiles were the first choice but now require
 * an API key — the tiles render "API KEY REQUIRED" without one.)
 *
 * Zoom is capped at MAX_ZOOM: the perfect radius is 25 km, so there's no reason
 * to zoom to street level, and detail at deep zoom would start to give towns
 * away.
 */

import L from 'leaflet'
import { log } from './log'

const ESRI_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'
export const TILE_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'

/** Deepest zoom a player can reach. 10 ≈ 150 m/px: county scale, no street names. */
export const MAX_ZOOM = 10

export function makeTileLayer(): L.TileLayer {
  log.debug('tiles', 'tile provider: esri light gray canvas (base, no labels)')
  return L.tileLayer(ESRI_URL, {
    attribution: TILE_ATTRIBUTION,
    maxNativeZoom: 16,
    maxZoom: MAX_ZOOM,
  })
}
