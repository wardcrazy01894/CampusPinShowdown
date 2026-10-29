/**
 * State outlines drawn over the night imagery (which has no borders). The
 * GeoJSON is the Census Bureau's 1:20m cartographic boundary file, public
 * domain, simplified to ~1 km and cut to the lower 48 + DC (≈ the play
 * region). Bundled as a module so it ships with the app and is cached by
 * content hash — no extra fetch, no key.
 */

import L from 'leaflet'
import type { GeoJsonObject } from 'geojson'
import usStates from '../data/us-states.json'

/** Pane name: its own stacking layer, UNDER the guess/reveal markers. */
export const STATES_PANE = 'states'

export const STATE_OUTLINE_STYLE: L.PathOptions = {
  color: '#9fb3c8',
  weight: 1,
  opacity: 0.55,
  fill: false,
  interactive: false,
}

/** Create the outline layer. Call `map.createPane(STATES_PANE)` first. */
export function makeStateOutlines(): L.GeoJSON {
  return L.geoJSON(usStates as unknown as GeoJsonObject, {
    style: STATE_OUTLINE_STYLE,
    pane: STATES_PANE,
    interactive: false,
  })
}
