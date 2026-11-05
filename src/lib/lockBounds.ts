/**
 * lockMapToBounds — lock a Leaflet map's WIDEST view to the play area, and
 * nothing else. Shared by the play map (MapGuess) and the recap map (RecapMap).
 *
 * Owner's call (2026-11-05, after two rounds of phone feedback): the map must
 * never move on its own. So:
 *
 *   - min zoom = the fit of the play bounds (re-locked on resize), so the
 *     player can't zoom out past "the whole country";
 *   - `bounceAtZoomLimits` off: a pinch past min zoom just stops there instead
 *     of overshooting and springing back (Leaflet's default), which read as
 *     "it recentres when I zoom";
 *   - NO `maxBounds`. Every bounds scheme we tried moved the map by itself:
 *     a box smaller than the viewport slides and snaps back to centre, a
 *     viscous edge overshoots and springs back, and a box re-fitted per zoom
 *     pans the view back inside after each zoom. With no box the map goes
 *     exactly where the finger puts it. The player CAN drag the country off
 *     the screen; they drag it back.
 *
 * Call after the map has a view (after fitBounds). Returns an unsubscribe.
 */

import type L from 'leaflet'

type LatLngBoundsTuple = [[number, number], [number, number]]

export function lockMapToBounds(
  map: L.Map,
  bounds: LatLngBoundsTuple,
): () => void {
  map.options.bounceAtZoomLimits = false
  const apply = () => {
    // getBoundsZoom clamps to the CURRENT min zoom, so with the old lock in
    // place a bigger viewport (phone rotated to landscape) could never lower
    // it. Lift the lock while computing the fit, then set it only if it
    // changed (setMinZoom fires events, and zooms the map in if it is below
    // the new floor — e.g. a phone URL bar hiding while at the widest view
    // can tip the fit over an integer step; rare, and the only time this
    // map moves by itself).
    const current = map.options.minZoom
    map.options.minZoom = undefined
    const next = map.getBoundsZoom(bounds)
    map.options.minZoom = current
    if (current !== next) map.setMinZoom(next)
  }
  apply()
  map.on('resize', apply)
  return () => {
    map.off('resize', apply)
  }
}
