import { describe, it, expect } from 'vitest'
import { searchSchools, schoolCount } from './search'
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
  town('Moorhead', 'MN', 'Minnesota', [
    'Minnesota State University Moorhead',
    'Concordia College',
  ]),
  town('Stanford', 'CA', 'California', ['Stanford University']),
  town('Tuscaloosa', 'AL', 'Alabama', ['University of Alabama']),
]

describe('searchSchools', () => {
  it('returns [] for queries under 2 chars', () => {
    expect(searchSchools(data, '')).toEqual([])
    expect(searchSchools(data, 'a')).toEqual([])
  })

  it('finds a school by any part of its name, ignoring case and punctuation', () => {
    expect(searchSchools(data, 'STANFORD')).toEqual(['Stanford University'])
    expect(searchSchools(data, 'univ. of georgia')).toEqual([])
    expect(searchSchools(data, 'university-of georgia')).toEqual([
      'University of Georgia',
    ])
  })

  it('finds every school of a town, not just the first', () => {
    expect(searchSchools(data, 'concordia')).toEqual(['Concordia College'])
  })

  it('puts a name that STARTS with the query first, then earlier matches, then A–Z', () => {
    expect(searchSchools(data, 'michigan')).toEqual([
      'Michigan State University',
      'University of Michigan',
    ])
    expect(searchSchools(data, 'university of')).toEqual([
      'University of Alabama',
      'University of Georgia',
      'University of Michigan',
    ])
  })

  it('never matches on the TOWN or the STATE — that would be a spoiler', () => {
    // "Ann Arbor" and "Tuscaloosa" are answers; no school is named for them.
    expect(searchSchools(data, 'ann arbor')).toEqual([])
    expect(searchSchools(data, 'tuscaloosa')).toEqual([])
    // "Ohio" finds Ohio University by its NAME, not Athens by its state.
    expect(searchSchools(data, 'ohio')).toEqual(['Ohio University'])
    expect(searchSchools(data, 'california')).toEqual([])
  })

  it('lists a school once even if two towns carry it', () => {
    const twice = [
      ...data,
      town('Elsewhere', 'TX', 'Texas', ['Ohio University']),
    ]
    expect(searchSchools(twice, 'ohio')).toEqual(['Ohio University'])
  })
})

describe('schoolCount', () => {
  it('counts distinct schools across all towns', () => {
    expect(schoolCount(data)).toBe(8)
  })
})
