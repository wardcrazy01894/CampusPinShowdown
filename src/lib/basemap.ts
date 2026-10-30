/**
 * Which imagery the maps show — a per-device display preference, like mute.
 *
 *   satellite  EOX Sentinel-2 cloudless (daytime true colour) — the default
 *   night      NASA Black Marble (city lights; the original look, opt-in)
 *
 * Stored in localStorage; never part of the game save, so it can't affect a
 * day's record or the share card. The tile definitions live in tiles.ts.
 */

export type Basemap = 'night' | 'satellite'

export const BASEMAP_KEY = 'cps:basemap'

/** What a player sees before they ever touch the toggle. */
export const DEFAULT_BASEMAP: Basemap = 'satellite'

export function isBasemap(v: unknown): v is Basemap {
  return v === 'night' || v === 'satellite'
}

export function getBasemap(): Basemap {
  try {
    const v = localStorage.getItem(BASEMAP_KEY)
    return isBasemap(v) ? v : DEFAULT_BASEMAP
  } catch {
    return DEFAULT_BASEMAP
  }
}

export function setBasemap(b: Basemap): void {
  try {
    localStorage.setItem(BASEMAP_KEY, b)
  } catch {
    // storage unavailable (private mode / quota) — the choice just won't stick
  }
}

export function nextBasemap(b: Basemap): Basemap {
  return b === 'night' ? 'satellite' : 'night'
}
