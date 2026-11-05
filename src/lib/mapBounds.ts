/**
 * Map-geometry helpers (pure — no Leaflet/DOM so they're unit-testable).
 *
 * (History: this file also held the `maxBounds` padding/viscosity constants.
 * The play map no longer has a maxBounds at all — see lockBounds.ts.)
 */

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
