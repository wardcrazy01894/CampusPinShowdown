import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { HINT_REGIONS, hintRegion, hintText } from './hintRegions'
import type { TownsFile } from '../types'

const LOWER_48_DC = [
  'AL',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'DC',
  'FL',
  'GA',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
]

describe('HINT_REGIONS', () => {
  it('partitions the lower 48 + DC: every state in exactly one region', () => {
    const seen = new Map<string, number>()
    for (const r of HINT_REGIONS)
      for (const s of r.states) seen.set(s, (seen.get(s) ?? 0) + 1)
    expect([...seen.keys()].sort()).toEqual([...LOWER_48_DC].sort())
    expect([...seen.values()].every((n) => n === 1)).toBe(true)
  })

  it('keeps every region a real hint: 3–6 states, never one', () => {
    for (const r of HINT_REGIONS) {
      expect(r.states.length, r.name).toBeGreaterThanOrEqual(3)
      expect(r.states.length, r.name).toBeLessThanOrEqual(6)
    }
  })

  it('covers every state in the shipped dataset', () => {
    const file = JSON.parse(
      readFileSync(new URL('../../public/towns.json', import.meta.url), 'utf8'),
    ) as TownsFile
    for (const t of file.towns)
      expect(() => hintRegion(t.stateCode)).not.toThrow()
  })
})

describe('hintRegion / hintText', () => {
  it('names the region and lists its states — never the one state alone', () => {
    expect(hintRegion('MI').name).toBe('the Great Lakes')
    expect(hintText('TX')).toBe('the Southwest (TX, NM, AZ)')
    expect(hintText('MI')).toMatch(/\(OH, MI, IN, IL, WI\)/)
    expect(() => hintRegion('AK')).toThrow(/no hint region/)
  })
})
