import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  schoolsUrl,
  findSchoolFacts,
  factChips,
  formatEnrollment,
  formatAthletics,
  formatRanking,
  loadSchoolFacts,
  resetSchoolFactsCache,
  wikipediaUrl,
} from './schoolFacts'
import type { SchoolFacts, SchoolsFile } from '../types'

const ttu: SchoolFacts = {
  school: 'Texas Tech University',
  wikipedia: 'Texas Tech University',
  funFact: 'The Masked Rider leads the team out.',
  type: 'Public',
  founded: 1923,
  undergrad: 34184,
  postgrad: 8271,
  enrollmentAsOf: 'fall 2025',
  mascot: 'Masked Rider, Raider Red',
  nickname: 'Red Raiders',
  division: 'NCAA Division I FBS',
  conference: 'Big 12',
  ranking: { list: 'National Universities', rank: 186 },
  alumni: ['Someone (actor)'],
}
const file: SchoolsFile = {
  version: 1,
  generated: '2026-11-08',
  attribution: 'Wikipedia',
  rankingEdition: 2026,
  schools: [ttu],
}

describe('schoolsUrl', () => {
  it('lives next to towns.json under the Vite base', () => {
    expect(schoolsUrl()).toMatch(/\/schools\.json$/)
  })
})

describe('findSchoolFacts', () => {
  it('matches the prompt school by exact name, else undefined', () => {
    expect(findSchoolFacts(file, 'Texas Tech University')).toBe(ttu)
    expect(findSchoolFacts(file, 'Nowhere U')).toBeUndefined()
    expect(findSchoolFacts(null, 'Texas Tech University')).toBeUndefined()
  })
})

describe('formatters', () => {
  it('formatEnrollment: undergrad / grad with thousands separators, as-of when known', () => {
    expect(formatEnrollment(ttu)).toBe(
      '34,184 undergrad · 8,271 grad (fall 2025)',
    )
    expect(formatEnrollment({ ...ttu, postgrad: undefined })).toBe(
      '34,184 undergrad (fall 2025)',
    )
    expect(
      formatEnrollment({
        ...ttu,
        undergrad: undefined,
        enrollmentAsOf: undefined,
      }),
    ).toBe('8,271 grad students')
    expect(
      formatEnrollment({ ...ttu, undergrad: undefined, postgrad: undefined }),
    ).toBe('')
  })
  it('formatAthletics: nickname, conference and a short division', () => {
    expect(formatAthletics(ttu)).toBe('Red Raiders · Big 12 · D-I FBS')
    expect(
      formatAthletics({
        ...ttu,
        nickname: undefined,
        division: 'NCAA Division III',
      }),
    ).toBe('Big 12 · D-III')
    expect(
      formatAthletics({
        ...ttu,
        nickname: undefined,
        conference: undefined,
        division: 'NAIA',
      }),
    ).toBe('NAIA')
    expect(
      formatAthletics({
        ...ttu,
        nickname: undefined,
        conference: undefined,
        division: undefined,
      }),
    ).toBe('')
  })
  it('formatRanking: "#186 National Universities (U.S. News 2026)"', () => {
    expect(formatRanking(ttu, 2026)).toBe(
      '#186 National Universities (U.S. News 2026)',
    )
    expect(formatRanking({ ...ttu, ranking: undefined }, 2026)).toBe('')
    expect(
      formatRanking({ ...ttu, ranking: { list: 'Regional', rank: 3 } }, 2026),
    ).toBe('#3 in its region (U.S. News 2026)')
  })
})

describe('factChips', () => {
  it('lists only the stats the row has, in a fixed order', () => {
    expect(factChips(ttu, 2026)).toEqual([
      { icon: '🏛️', text: 'Public · founded 1923' },
      { icon: '🎓', text: '34,184 undergrad · 8,271 grad (fall 2025)' },
      { icon: '🏟️', text: 'Red Raiders · Big 12 · D-I FBS' },
      { icon: '🦅', text: 'Mascot: Masked Rider, Raider Red' },
      { icon: '🏅', text: '#186 National Universities (U.S. News 2026)' },
    ])
  })
  it('drops empty chips and copes with a bare row', () => {
    expect(
      factChips({ school: 'X', wikipedia: 'X', funFact: 'f' }, 2026),
    ).toEqual([])
    expect(factChips({ ...ttu, type: undefined }, 2026)[0]).toEqual({
      icon: '🏛️',
      text: 'Founded 1923',
    })
  })
})

describe('loadSchoolFacts', () => {
  beforeEach(() => resetSchoolFactsCache())
  afterEach(() => vi.unstubAllGlobals())

  it('fetches schools.json once and shares the result', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => file }))
    vi.stubGlobal('fetch', f)
    const [a, b] = await Promise.all([loadSchoolFacts(), loadSchoolFacts()])
    expect(a).toEqual(file)
    expect(b).toBe(a)
    expect(f).toHaveBeenCalledTimes(1)
    expect(String((f.mock.calls[0] as unknown[])[0])).toMatch(/schools\.json$/)
  })
  it('resolves null (never throws) on a network or HTTP failure, and retries next call', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => file })
    vi.stubGlobal('fetch', f)
    expect(await loadSchoolFacts()).toBeNull()
    expect(await loadSchoolFacts()).toEqual(file)
  })
  it('rejects a malformed file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ nope: 1 }) })),
    )
    expect(await loadSchoolFacts()).toBeNull()
  })
})

describe('wikipediaUrl', () => {
  it('links the article title with underscores, percent-encoded', () => {
    expect(wikipediaUrl('Texas Tech University')).toBe(
      'https://en.wikipedia.org/wiki/Texas_Tech_University',
    )
    expect(wikipediaUrl('Sewanee: The University of the South')).toBe(
      'https://en.wikipedia.org/wiki/Sewanee:_The_University_of_the_South',
    )
    expect(wikipediaUrl('University of Wisconsin–Eau Claire')).toBe(
      'https://en.wikipedia.org/wiki/University_of_Wisconsin%E2%80%93Eau_Claire',
    )
  })
})
