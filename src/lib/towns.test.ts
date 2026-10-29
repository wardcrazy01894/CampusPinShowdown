import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { REGION, inRegion } from './region'
import { ROUNDS_PER_DAY, selectDailyTowns } from './daily'
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

  it('spot-checks a few well-known pins (catches a geocoder picking the wrong place)', () => {
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
