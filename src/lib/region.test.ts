import { describe, it, expect, afterEach, vi } from 'vitest'
import { REGION, inRegion, townsUrl } from './region'

afterEach(() => vi.unstubAllEnvs())

describe('REGION (lower 48)', () => {
  it('contains towns from every corner of the country', () => {
    const corners = [
      { name: 'Orono, ME', lat: 44.88, lng: -68.67 },
      { name: 'Gainesville, FL', lat: 29.65, lng: -82.32 },
      { name: 'Eugene, OR', lat: 44.05, lng: -123.09 },
      { name: 'Bellingham, WA', lat: 48.75, lng: -122.48 },
      { name: 'Las Cruces, NM', lat: 32.31, lng: -106.78 },
      { name: 'Coral Gables, FL', lat: 25.72, lng: -80.27 },
    ]
    for (const t of corners) expect(inRegion(REGION, t), t.name).toBe(true)
  })

  it('excludes Alaska and Hawaii (out of play for now)', () => {
    expect(inRegion(REGION, { lat: 64.84, lng: -147.72 })).toBe(false) // Fairbanks
    expect(inRegion(REGION, { lat: 21.3, lng: -157.86 })).toBe(false) // Honolulu
  })

  it('townsUrl is relative to the Vite base (project page), not the origin root', () => {
    vi.stubEnv('BASE_URL', '/CampusPinShowdown/')
    expect(townsUrl()).toBe('/CampusPinShowdown/towns.json')
  })

  it('is well-formed: south < north, west < east', () => {
    const [[s, w], [n, e]] = REGION.bounds
    expect(s).toBeLessThan(n)
    expect(w).toBeLessThan(e)
  })
})
