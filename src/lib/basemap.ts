/**
 * Which imagery the maps show — a per-device display preference, like mute.
 *
 *   night      NASA Black Marble (the default; city lights are the hint)
 *   satellite  EOX Sentinel-2 cloudless (daytime true colour)
 *
 * Stored in localStorage; never part of the game save, so it can't affect a
 * day's record or the share card. The tile definitions live in tiles.ts.
 */

export type Basemap = 'night' | 'satellite'

export const BASEMAP_KEY = 'cps:basemap'

export function isBasemap(v: unknown): v is Basemap {
  return v === 'night' || v === 'satellite'
}

export function getBasemap(): Basemap {
  try {
    const v = localStorage.getItem(BASEMAP_KEY)
    return isBasemap(v) ? v : 'night'
  } catch {
    return 'night'
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
