import { describe, it, expect } from 'vitest'
import {
  slug,
  validateSeed,
  nominatimQuery,
  pickResult,
  inConus,
  toTown,
  sortTowns,
  CONUS,
  censusMismatches,
  censusToleranceKm,
  haversineKm,
  SETTLEMENT_RANK,
} from './build-towns-lib.mjs'
import { REGION } from '../src/lib/region'

const entry = {
  name: 'Ann Arbor',
  stateCode: 'MI',
  schools: ['University of Michigan'],
  difficulty: 'easy',
}

describe('slug', () => {
  it('kebab-cases name + state and folds punctuation/diacritics', () => {
    expect(slug('Ann Arbor', 'MI')).toBe('ann-arbor-mi')
    expect(slug('St. Peter', 'MN')).toBe('st-peter-mn')
    expect(slug('Winston-Salem', 'NC')).toBe('winston-salem-nc')
    expect(slug('Cañon City', 'CO')).toBe('canon-city-co')
  })
})

describe('validateSeed', () => {
  it('accepts a well-formed entry', () => {
    expect(validateSeed([entry])).toEqual([])
  })

  it('flags unknown states, bad difficulty, empty schools, half coords', () => {
    const problems = validateSeed([
      { ...entry, stateCode: 'ZZ' },
      { ...entry, name: 'X', difficulty: 'brutal' },
      { ...entry, name: 'Y', schools: [] },
      { ...entry, name: 'Z', lat: 42 },
    ])
    expect(problems.some((p) => p.includes('unknown stateCode'))).toBe(true)
    expect(problems.some((p) => p.includes('difficulty'))).toBe(true)
    expect(problems.some((p) => p.includes('schools'))).toBe(true)
    expect(problems.some((p) => p.includes('lat and lng'))).toBe(true)
  })

  it('flags duplicate (name, state) pairs but allows the same name in two states', () => {
    expect(
      validateSeed([entry, { ...entry }]).some((p) => p.includes('duplicate')),
    ).toBe(true)
    expect(validateSeed([entry, { ...entry, stateCode: 'OH' }])).toEqual([])
  })
})

describe('nominatimQuery', () => {
  it('spells out the state and pins the country', () => {
    expect(nominatimQuery(entry)).toBe('Ann Arbor, Michigan, USA')
  })
})

describe('pickResult', () => {
  const hit = (over) => ({
    category: 'place',
    type: 'city',
    addresstype: 'city',
    lat: '42.28',
    lon: '-83.74',
    importance: 0.5,
    address: { state: 'Michigan' },
    ...over,
  })

  it('rejects hits in the wrong state, counties, and non-settlements', () => {
    expect(pickResult([hit({ address: { state: 'Ohio' } })], entry)).toBeNull()
    // Hamilton County for Hamilton, NY: a boundary whose addresstype is county.
    expect(
      pickResult(
        [
          hit({
            category: 'boundary',
            type: 'administrative',
            addresstype: 'county',
          }),
        ],
        entry,
      ),
    ).toBeNull()
    expect(
      pickResult(
        [
          hit({
            category: 'amenity',
            type: 'university',
            addresstype: 'amenity',
          }),
        ],
        entry,
      ),
    ).toBeNull()
    expect(pickResult([], entry)).toBeNull()
  })

  it('prefers a city/town/village over a same-named neighbourhood or hamlet, whatever the importance', () => {
    // Claremont, CA: the Berkeley neighbourhood scores higher importance than
    // the real city; Ada, OH: a hamlet by the Ohio River vs the village.
    const neighbourhood = hit({
      addresstype: 'neighbourhood',
      importance: 0.9,
      lat: '37.86',
    })
    const hamlet = hit({ addresstype: 'hamlet', importance: 0.8, lat: '38.84' })
    const city = hit({
      category: 'boundary',
      type: 'administrative',
      addresstype: 'city',
      importance: 0.3,
      lat: '34.12',
    })
    expect(pickResult([neighbourhood, hamlet, city], entry)).toBe(city)
  })

  it('accepts a boundary/administrative row when its addresstype is a settlement', () => {
    const cityBoundary = hit({
      category: 'boundary',
      type: 'administrative',
      addresstype: 'city',
    })
    expect(pickResult([cityBoundary], entry)).toBe(cityBoundary)
  })

  it('breaks ties within a settlement kind by importance', () => {
    const low = hit({ importance: 0.3, lat: '1' })
    const high = hit({ importance: 0.6, lat: '2' })
    expect(pickResult([low, high], entry)).toBe(high)
  })

  it('ranks settlement kinds city-first and never lists county/state', () => {
    expect(SETTLEMENT_RANK[0]).toBe('city')
    expect(SETTLEMENT_RANK).not.toContain('county')
    expect(SETTLEMENT_RANK).not.toContain('state')
  })
})

describe('censusMismatches', () => {
  const pins = {
    'ann-arbor-mi': {
      lat: 42.2808,
      lng: -83.743,
      place: 'Ann Arbor city',
      alandKm2: 73,
    },
  }
  it('tolerance is 10 km for a town and grows with land area for a sprawling city', () => {
    expect(censusToleranceKm({ alandKm2: 8 })).toBe(10) // Gunnison-sized
    expect(censusToleranceKm({ alandKm2: 73 })).toBe(10) // Ann Arbor
    expect(censusToleranceKm({ alandKm2: 610 })).toBeCloseTo(20.9, 0) // Tucson
    expect(censusToleranceKm({})).toBe(10)
  })
  it('passes a pin within tolerance and flags one outside it or missing', () => {
    expect(
      censusMismatches([{ id: 'ann-arbor-mi', lat: 42.29, lng: -83.75 }], pins),
    ).toEqual([])
    const far = censusMismatches(
      [{ id: 'ann-arbor-mi', lat: 42.73, lng: -84.48 }],
      pins,
    )
    expect(far).toHaveLength(1)
    expect(far[0].km).toBeGreaterThan(40)
    expect(
      censusMismatches([{ id: 'nowhere-xx', lat: 0, lng: 0 }], pins)[0].reason,
    ).toBe('no Census pin')
  })
  it('haversineKm agrees with the app (one degree of latitude ≈ 111 km)', () => {
    expect(
      haversineKm({ lat: 40, lng: -90 }, { lat: 41, lng: -90 }),
    ).toBeCloseTo(111.2, 0)
  })
})

describe('inConus / CONUS', () => {
  it('mirrors src/lib/region.ts bounds exactly (keep them in sync)', () => {
    const [[s, w], [n, e]] = REGION.bounds
    expect(CONUS).toEqual({ south: s, west: w, north: n, east: e })
  })

  it('accepts a lower-48 town and rejects Honolulu', () => {
    expect(inConus({ lat: 42.28, lng: -83.74 })).toBe(true)
    expect(inConus({ lat: 21.3, lng: -157.86 })).toBe(false)
  })
})

describe('toTown', () => {
  it('builds a Town row with rounded coords and provenance', () => {
    const t = toTown(entry, {
      lat: 42.28081234,
      lng: -83.74301234,
      source: 'nominatim',
    })
    expect(t).toEqual({
      id: 'ann-arbor-mi',
      name: 'Ann Arbor',
      state: 'Michigan',
      stateCode: 'MI',
      schools: ['University of Michigan'],
      lat: 42.2808,
      lng: -83.743,
      difficulty: 'easy',
      source: 'nominatim',
      attribution: '© OpenStreetMap contributors (ODbL), via Nominatim',
    })
  })

  it('marks hand-pinned coordinates as manual', () => {
    expect(
      toTown(entry, { lat: 1, lng: 2, source: 'manual' }).attribution,
    ).toBe('hand-pinned')
  })
})

describe('sortTowns', () => {
  it('orders by id without mutating the input', () => {
    const a = { id: 'b' }
    const b = { id: 'a' }
    const input = [a, b]
    expect(sortTowns(input)).toEqual([b, a])
    expect(input).toEqual([a, b])
  })
})
