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
    lat: '42.28',
    lon: '-83.74',
    importance: 0.5,
    address: { state: 'Michigan' },
    ...over,
  })

  it('rejects hits in the wrong state and non-settlement types', () => {
    expect(pickResult([hit({ address: { state: 'Ohio' } })], entry)).toBeNull()
    expect(
      pickResult([hit({ category: 'amenity', type: 'university' })], entry),
    ).toBeNull()
    expect(pickResult([], entry)).toBeNull()
  })

  it('prefers a place over a boundary, then higher importance', () => {
    const boundary = hit({
      category: 'boundary',
      type: 'administrative',
      importance: 0.9,
    })
    const lowPlace = hit({ importance: 0.3, lat: '1' })
    const highPlace = hit({ importance: 0.6, lat: '2' })
    expect(pickResult([boundary, lowPlace, highPlace], entry)).toBe(highPlace)
    expect(pickResult([boundary], entry)).toBe(boundary)
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
