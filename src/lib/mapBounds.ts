/**
 * Map-bounds helpers (pure — no Leaflet/DOM so they're unit-testable).
 *
 * Why padding exists (inherited from KnowYourCity): MapGuess locks the map with `maxBounds` +
 * `maxBoundsViscosity: 1`. With maxBounds set to EXACTLY the play bounds, the
 * hard wall sits flush against playable towns: integer zoom snapping can
 * leave a whole axis unpannable just above min zoom, and a location on the
 * bounds edge can never be panned toward the screen center. Padding the lock
 * box (but NOT the min-zoom fit) keeps players on the USA while giving the
 * viewport room to reach every corner of the play area.
 */

type LatLngBoundsTuple = [[number, number], [number, number]]

/**
 * How much slack MapGuess gives `maxBounds` around the play area, per side, as
 * a fraction of each axis. KnowYourCity uses 0.3 at city scale; on the lower-48
 * box that would be ~7.5° of latitude / ~17.6° of longitude per side (deep into
 * Mexico, Canada and open ocean). 0.05 ≈ 1.3° / 3° — enough to centre a coastal
 * town, not enough to lose the country.
 */
export const MAX_BOUNDS_PAD = 0.05

/**
 * How hard the padded `maxBounds` edge pushes back on a drag (Leaflet's
 * `maxBoundsViscosity`, 0–1). It was 1.0 — a rigid wall — and on a phone,
 * where the whole country fits in a few hundred pixels, every pan ran into
 * it and "the map is hard to move around". 0.6 keeps the map on the USA but
 * lets the edge give and spring back, so a drag near a coast never just
 * stops dead.
 */
export const MAX_BOUNDS_VISCOSITY = 0.6

/** Expand a [[south, west], [north, east]] box by `ratio` of each axis extent
 *  on every side (mirrors Leaflet's `LatLngBounds.pad`). */
export function padBounds(
  bounds: LatLngBoundsTuple,
  ratio: number = MAX_BOUNDS_PAD,
): LatLngBoundsTuple {
  const [[south, west], [north, east]] = bounds
  const latPad = (north - south) * ratio
  const lngPad = (east - west) * ratio
  return [
    [south - latPad, west - lngPad],
    [north + latPad, east + lngPad],
  ]
}

/** The four edges of a box in page pixels (a `DOMRect` is one). */
export interface Rect {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * How far elements floating over the map's top and bottom edges reach into
 * it, in pixels — the phone play layout puts the prompt card and the action
 * bar OVER the map (index.css `.play__prompt` / `.play__actions`), and the
 * reveal must frame the pins in the part that is actually visible. On wide
 * screens the cards stack beside the map, nothing overlaps and both insets
 * are 0, so the fit is unchanged. A cover is counted against the edge its
 * centre is nearer to; covers beside the map (no horizontal overlap) are
 * ignored.
 */
export function coverInsets(
  map: Rect,
  covers: Rect[],
): { top: number; bottom: number } {
  let top = 0
  let bottom = 0
  const mid = (map.top + map.bottom) / 2
  for (const c of covers) {
    if (c.right <= map.left || c.left >= map.right) continue
    if (c.bottom <= map.top || c.top >= map.bottom) continue
    if ((c.top + c.bottom) / 2 < mid) {
      top = Math.max(top, c.bottom - map.top)
    } else {
      bottom = Math.max(bottom, map.bottom - c.top)
    }
  }
  return { top, bottom }
}
