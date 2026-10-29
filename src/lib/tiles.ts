/**
 * The basemap for every Leaflet map in the app. A college-town game wants a
 * CLEAN map — state borders and terrain are fair, city labels are not — so the
 * default is CARTO's "Positron (no labels)" raster tiles: free for
 * non-commercial use, no key, OSM-derived (attribution required and rendered by
 * Leaflet's attribution control). Zoom is capped at MAX_ZOOM: the perfect
 * radius is 25 km, so there's no reason to zoom to street level, and the
 * roads at deep zoom would start to give towns away.
 */

import L from 'leaflet'
import { log } from './log'

const CARTO_URL =
  'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png'
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

/** Deepest zoom a player can reach. 10 ≈ 150 m/px: county scale, no street names. */
export const MAX_ZOOM = 10

export function makeTileLayer(): L.TileLayer {
  log.debug('tiles', 'tile provider: carto light_nolabels')
  return L.tileLayer(CARTO_URL, {
    attribution: TILE_ATTRIBUTION,
    subdomains: 'abcd',
    maxZoom: MAX_ZOOM,
  })
}
