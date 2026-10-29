/**
 * State outlines drawn over the night imagery (which has no borders). The
 * GeoJSON is the Census Bureau's 1:20m cartographic boundary file, public
 * domain, simplified to ~1 km and cut to the lower 48 + DC (≈ the play
 * region). Loaded with a dynamic import so it becomes its own content-hashed
 * chunk (~120 KB) fetched after the map mounts, instead of sitting in the main
 * bundle ahead of first paint — no key, cached like any asset.
 */

import L from 'leaflet'
import type { GeoJsonObject } from 'geojson'

/** Pane name: its own stacking layer, UNDER the guess/reveal markers. */
export const STATES_PANE = 'states'

export const STATE_OUTLINE_STYLE: L.PathOptions = {
  color: '#9fb3c8',
  weight: 1,
  opacity: 0.55,
  fill: false,
  interactive: false,
}

/** Create the outline layer (async: loads the GeoJSON chunk). Call
 *  `map.createPane(STATES_PANE)` first. */
export async function makeStateOutlines(): Promise<L.GeoJSON> {
  const { default: usStates } = await import('../data/us-states.json')
  return L.geoJSON(usStates as unknown as GeoJsonObject, {
    style: STATE_OUTLINE_STYLE,
    pane: STATES_PANE,
    interactive: false,
  })
}
