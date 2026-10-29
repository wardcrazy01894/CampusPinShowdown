import { describe, it, expect } from 'vitest'
import { searchTowns, isIncluded } from './search'
import type { Town } from '../types'

const town = (
  name: string,
  stateCode: string,
  state: string,
  schools: string[],
): Town => ({
  id: `${name.toLowerCase().replace(/\s+/g, '-')}-${stateCode.toLowerCase()}`,
  name,
  state,
  stateCode,
  schools,
  lat: 40,
  lng: -90,
  difficulty: 'medium',
  source: 'manual',
  attribution: 't',
})

const data = [
  town('Ann Arbor', 'MI', 'Michigan', ['University of Michigan']),
  town('East Lansing', 'MI', 'Michigan', ['Michigan State University']),
  town('Athens', 'GA', 'Georgia', ['University of Georgia']),
  town('Athens', 'OH', 'Ohio', ['Ohio University']),
  town('Boulder', 'CO', 'Colorado', ['University of Colorado Boulder']),
  town('Chapel Hill', 'NC', 'North Carolina', ['University of North Carolina']),
  town('Stanford', 'CA', 'California', ['Stanford University']),
]

describe('searchTowns', () => {
  it('returns [] for queries under 2 chars', () => {
    expect(searchTowns(data, '')).toEqual([])
    expect(searchTowns(data, 'a')).toEqual([])
  })

  it('matches town names case-insensitively on substring', () => {
    expect(searchTowns(data, 'arbor').map((t) => t.id)).toEqual([
      'ann-arbor-mi',
    ])
  })

  it('matches by school name', () => {
    expect(searchTowns(data, 'michigan state').map((t) => t.id)).toEqual([
      'east-lansing-mi',
    ])
  })

  it('matches by state and by "Name, ST"', () => {
    expect(searchTowns(data, 'georgia').map((t) => t.id)).toEqual(['athens-ga'])
    expect(searchTowns(data, 'athens, oh').map((t) => t.id)).toEqual([
      'athens-oh',
    ])
  })

  it('ranks a town-name prefix match above a school/state match', () => {
    // "col" is a prefix of Colorado (state) and of nothing else by name except…
    // "Chapel Hill"? no. Boulder matches via "Colorado". Add a name-prefix case:
    const names = searchTowns(data, 'st').map((t) => t.name)
    // "Stanford" (name prefix) must come before East Lansing (Michigan STate — substring).
    expect(names[0]).toBe('Stanford')
  })

  it('respects the limit', () => {
    expect(searchTowns(data, 'university', 3)).toHaveLength(3)
  })
})

describe('isIncluded', () => {
  it('is true for an exact (normalized) town name, "Name, ST", or school', () => {
    expect(isIncluded(data, 'ann arbor')).toBe(true)
    expect(isIncluded(data, 'Ann Arbor, MI')).toBe(true)
    expect(isIncluded(data, 'university of michigan')).toBe(true)
  })

  it('is false for a state name alone or an absent town', () => {
    expect(isIncluded(data, 'Michigan')).toBe(false)
    expect(isIncluded(data, 'Tuscaloosa')).toBe(false)
  })
})
