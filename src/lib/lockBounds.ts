/**
 * lockMapToBounds — keep a Leaflet map on the play area, with no spring-back.
 *
 * Shared by the play map (MapGuess) and the results recap map (RecapMap).
 * Three things, re-applied on every `zoomend` and `resize`:
 *
 *   1. min zoom = the fit of the UNPADDED play bounds, so the widest view is
 *      "the whole country" and the player can't zoom out past it;
 *   2. maxBounds = the play bounds padded by MAX_BOUNDS_PAD, so a coastal
 *      town can be centred at any zoom;
 *   3. …grown to at least the viewport's size on any axis where it is
 *      smaller at the current zoom (expandToViewport), so Leaflet clamps the
 *      drag outright instead of letting the country slide and then animating
 *      it back to centre on release. See mapBounds.ts for the why.
 *
 * Call after the map has a view (after fitBounds). Returns an unsubscribe.
 */

import L from 'leaflet'
import { expandToViewport, padBounds } from './mapBounds'

type LatLngBoundsTuple = [[number, number], [number, number]]

export function lockMapToBounds(
  map: L.Map,
  bounds: LatLngBoundsTuple,
): () => void {
  const play = L.latLngBounds(bounds)
  const padded = L.latLngBounds(padBounds(bounds))
  const apply = () => {
    map.setMinZoom(map.getBoundsZoom(play))
    const zoom = map.getZoom()
    const size = map.getSize()
    // No view yet, or a 0×0 container (jsdom / display:none): nothing to fit
    // the box to — keep the plain padded lock.
    if (!Number.isFinite(zoom) || size.x <= 0 || size.y <= 0) {
      map.setMaxBounds(padded)
      return
    }
    const nw = map.project(padded.getNorthWest(), zoom)
    const se = map.project(padded.getSouthEast(), zoom)
    const grown = expandToViewport(
      { min: { x: nw.x, y: nw.y }, max: { x: se.x, y: se.y } },
      size,
    )
    map.setMaxBounds(
      L.latLngBounds(
        map.unproject(L.point(grown.min), zoom),
        map.unproject(L.point(grown.max), zoom),
      ),
    )
  }
  apply()
  map.on('zoomend resize', apply)
  return () => {
    map.off('zoomend resize', apply)
  }
}
