/**
 * The single play region: the contiguous United States. KnowYourCity has one of
 * these per city (cities.json); this game has exactly one, so it's a constant.
 * The engine (daily.ts, mode.ts, storage.ts) is keyed by `REGION.id` so a
 * second region (Alaska/Hawaii, Canada…) could be added later without touching
 * the save-state format.
 */

export interface Region {
  /** Namespace for selection seeds and localStorage. */
  id: string
  name: string
  short: string
  /** Map play bounds, [[south, west], [north, east]]. The map is locked to this. */
  bounds: [[number, number], [number, number]]
}

export const REGION: Region = {
  id: 'usa',
  name: 'United States',
  short: 'USA',
  // Lower-48 box with a little slack so coastal towns (Eugene, Gainesville,
  // Orono) aren't flush against the wall. Alaska and Hawaii are out of play
  // for now — see BACKLOG.md.
  bounds: [
    [24.4, -125.2],
    [49.5, -66.6],
  ],
}

/** True when a point is inside the region's play box. Used by the data guard test. */
export function inRegion(
  region: Region,
  point: { lat: number; lng: number },
): boolean {
  const [[s, w], [n, e]] = region.bounds
  return point.lat >= s && point.lat <= n && point.lng >= w && point.lng <= e
}

/** URL of the bundled town dataset, relative to the Vite base (project page vs. custom domain). */
export function townsUrl(): string {
  return `${import.meta.env.BASE_URL}towns.json`
}
