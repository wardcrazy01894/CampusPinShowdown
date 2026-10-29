import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { REGION, inRegion } from './region'
import { ROUNDS_PER_DAY, selectDailyTowns } from './daily'
import { haversineMeters } from './scoring'
import type { TownsFile, Town } from '../types'

/**
 * Dataset guard: public/towns.json is a hand-curated artifact that ships to
 * every player. These assertions keep a bad rebuild (or hand edit) from
 * reaching main — schema, uniqueness, geography, and enough depth per tier.
 */
const file = JSON.parse(
  readFileSync(new URL('../../public/towns.json', import.meta.url), 'utf8'),
) as TownsFile
const towns = file.towns
const census = (
  JSON.parse(
    readFileSync(
      new URL('../../data/census-pins.json', import.meta.url),
      'utf8',
    ),
  ) as {
    pins: Record<
      string,
      { lat: number; lng: number; place: string; alandKm2?: number }
    >
  }
).pins
/** Mirrors censusToleranceKm in scripts/build-towns-lib.mjs: 10 km, or 1.5× the
 *  place's equivalent radius for sprawling cities. */
const censusToleranceKm = (pin: { alandKm2?: number }) =>
  Math.max(10, 1.5 * Math.sqrt((pin.alandKm2 ?? 0) / Math.PI))

describe('public/towns.json', () => {
  it('has the expected envelope', () => {
    expect(file.version).toBe(1)
    expect(file.region).toBe(REGION.id)
    expect(file.attribution).toMatch(/OpenStreetMap/)
  })

  it('every row has the full Town shape', () => {
    for (const t of towns) {
      expect(typeof t.id, t.id).toBe('string')
      expect(t.id).toMatch(/^[a-z0-9-]+-[a-z]{2}$/)
      expect(t.name.trim().length).toBeGreaterThan(0)
      expect(t.state.trim().length).toBeGreaterThan(0)
      expect(t.stateCode).toMatch(/^[A-Z]{2}$/)
      expect(t.schools.length).toBeGreaterThan(0)
      expect(['easy', 'medium', 'hard']).toContain(t.difficulty)
      expect(['nominatim', 'manual']).toContain(t.source)
      expect(typeof t.lat).toBe('number')
      expect(typeof t.lng).toBe('number')
    }
  })

  it('ids are unique and sorted (rebuilds must diff minimally)', () => {
    const ids = towns.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([...ids].sort())
  })

  it('every town is inside the play region (lower 48)', () => {
    for (const t of towns) expect(inRegion(REGION, t), t.id).toBe(true)
  })

  it('has enough depth per difficulty for a varied month', () => {
    const by = (d: Town['difficulty']) =>
      towns.filter((t) => t.difficulty === d).length
    expect(by('easy')).toBeGreaterThanOrEqual(40)
    expect(by('medium')).toBeGreaterThanOrEqual(60)
    expect(by('hard')).toBeGreaterThanOrEqual(80)
  })

  it('EVERY pin agrees with the independent US Census Gazetteer pin (≤ 10 km, size-aware)', () => {
    // The real guard against a geocoder picking a same-named county,
    // neighbourhood or hamlet (PR #2 review found 11 such pins; all > 16 km).
    const bad: string[] = []
    for (const t of towns) {
      const c = census[t.id]
      if (!c) {
        bad.push(`${t.id}: no Census pin`)
        continue
      }
      const km = haversineMeters(t, c) / 1000
      const tol = censusToleranceKm(c)
      if (km > tol)
        bad.push(
          `${t.id}: ${km.toFixed(1)} km from ${c.place} (tol ${tol.toFixed(0)})`,
        )
    }
    expect(bad).toEqual([])
  })

  it('spot-checks the pins the PR #2 review found wrong (regression) + a few famous ones', () => {
    const near = (id: string, lat: number, lng: number) => {
      const t = towns.find((x) => x.id === id)!
      expect(t, id).toBeTruthy()
      expect(Math.abs(t.lat - lat), `${id} lat`).toBeLessThan(0.1)
      expect(Math.abs(t.lng - lng), `${id} lng`).toBeLessThan(0.1)
    }
    near('ann-arbor-mi', 42.28, -83.74)
    near('athens-ga', 33.96, -83.38)
    near('athens-oh', 39.33, -82.1)
    near('stanford-ca', 37.43, -122.17)
    near('west-point-ny', 41.39, -73.96)
    near('eugene-or', 44.05, -123.09)
    near('gainesville-fl', 29.65, -82.32)
    // The eleven mis-pins from the PR #2 review (county / neighbourhood / hamlet).
    near('ada-oh', 40.77, -83.82)
    near('canyon-tx', 34.98, -101.92)
    near('claremont-ca', 34.1, -117.72)
    near('clinton-ny', 43.05, -75.38)
    near('hamilton-ny', 42.83, -75.54)
    near('meadville-pa', 41.64, -80.15)
    near('kutztown-pa', 40.52, -75.78)
    near('bloomsburg-pa', 41.0, -76.45)
    near('kearney-ne', 40.7, -99.08)
    near('san-luis-obispo-ca', 35.28, -120.66)
    near('gunnison-co', 38.55, -106.93)
    near('santa-cruz-ca', 36.97, -122.03)
    // Dataset pass 2 (HBCUs / academies / D-III): names that exist in many
    // states or as neighbourhoods — the pins must be the Nominatim settlement.
    near('orange-ca', 33.79, -117.85)
    near('georgetown-tx', 30.64, -97.68)
    near('hanover-in', 38.71, -85.47)
    near('kings-point-ny', 40.82, -73.74)
    near('prairie-view-tx', 30.09, -95.99)
    near('clinton-sc', 34.47, -81.88)
  })

  it('selects a full, state-diverse lineup for every day of the first year', () => {
    for (let i = 0; i < 365; i++) {
      const d = new Date(Date.UTC(2026, 9, 29 + i)).toISOString().slice(0, 10)
      const picks = selectDailyTowns(towns, `usa:${d}`)
      expect(picks, d).toHaveLength(ROUNDS_PER_DAY)
      expect(new Set(picks.map((t) => t.stateCode)).size, d).toBe(
        ROUNDS_PER_DAY,
      )
    }
  })
})
