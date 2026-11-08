import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { promptSchool } from './schools'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- plain .mjs module, no types
// @ts-ignore
import { ALUMNI_BLOCKLIST } from '../../scripts/build-schools-lib.mjs'
import type { TownsFile, SchoolsFile, SchoolFacts } from '../types'

/**
 * Dataset guard: public/schools.json ships to every player and is the only
 * source for the post-guess school card. Keep a bad rebuild (or a hand edit)
 * from reaching main — envelope, one row per prompt school, sane fields.
 */
const url = new URL('../../public/schools.json', import.meta.url)
const file: SchoolsFile | null = existsSync(url)
  ? (JSON.parse(readFileSync(url, 'utf8')) as SchoolsFile)
  : null
const towns = (
  JSON.parse(
    readFileSync(new URL('../../public/towns.json', import.meta.url), 'utf8'),
  ) as TownsFile
).towns
const wanted = [...new Set(towns.map(promptSchool))]

describe('public/schools.json', () => {
  it('exists and has the expected envelope', () => {
    expect(file, 'run `npm run build-schools`').not.toBeNull()
    expect(file!.version).toBe(1)
    expect(file!.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(file!.attribution).toMatch(/Wikipedia/)
    expect(file!.rankingEdition).toBeGreaterThanOrEqual(2026)
    expect(Array.isArray(file!.schools)).toBe(true)
  })

  it('has exactly one row for every prompt school, sorted by school, and no strays', () => {
    const names = file!.schools.map((s) => s.school)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual([...wanted].sort())
    expect(names).toEqual([...names].sort())
  })

  it('every row has a Wikipedia title and a fun fact of sane length', () => {
    for (const s of file!.schools) {
      expect(s.wikipedia, s.school).toMatch(/\S/)
      expect(s.funFact.length, s.school).toBeGreaterThanOrEqual(20)
      expect(s.funFact.length, s.school).toBeLessThanOrEqual(320)
    }
  })

  it('numeric fields are plausible when present', () => {
    for (const s of file!.schools) {
      if (s.founded !== undefined) {
        expect(s.founded, s.school).toBeGreaterThanOrEqual(1600)
        expect(s.founded, s.school).toBeLessThanOrEqual(2026)
      }
      if (s.undergrad !== undefined) {
        expect(s.undergrad, s.school).toBeGreaterThan(100)
        expect(s.undergrad, s.school).toBeLessThan(200_000)
      }
      if (s.postgrad !== undefined) {
        expect(s.postgrad, s.school).toBeGreaterThanOrEqual(0)
        expect(s.postgrad, s.school).toBeLessThan(60_000)
      }
      if (s.ranking) {
        expect(s.ranking.rank, s.school).toBeGreaterThanOrEqual(1)
        expect(s.ranking.rank, s.school).toBeLessThanOrEqual(500)
        expect(
          [
            'National Universities',
            'National Liberal Arts Colleges',
            'Regional Universities',
            'Regional Colleges',
            'Regional',
          ],
          s.school,
        ).toContain(s.ranking.list)
      }
      if (s.type) expect(['Public', 'Private'], s.school).toContain(s.type)
      if (s.alumni) {
        expect(s.alumni.length, s.school).toBeLessThanOrEqual(5)
        for (const a of s.alumni) expect(a, s.school).toMatch(/\S/)
      }
    }
  })

  it('athletics, nickname and mascot are short, recognisable values (a parser miss would show here)', () => {
    for (const s of file!.schools) {
      if (s.division)
        expect(s.division, s.school).toMatch(
          /^(NCAA Division (I|II|III)( FBS| FCS)?|NAIA|NJCAA|USCAA|NCCAA)$/,
        )
      if (s.conference) {
        expect(
          s.conference.length,
          `${s.school}: ${s.conference}`,
        ).toBeLessThanOrEqual(40)
        expect(s.conference, s.school).not.toMatch(/^(NCAA|Division)/)
      }
      if (s.nickname)
        expect(
          s.nickname.length,
          `${s.school}: ${s.nickname}`,
        ).toBeLessThanOrEqual(40)
      if (s.mascot)
        expect(s.mascot.length, `${s.school}: ${s.mascot}`).toBeLessThanOrEqual(
          60,
        )
    }
  })

  it('alumni entries are short "Name (role)" strings and never blocklisted people', () => {
    for (const s of file!.schools) {
      for (const a of s.alumni ?? []) {
        expect(a.length, `${s.school}: ${a}`).toBeLessThanOrEqual(90)
        const role = a.match(/\(([^)]*)\)$/)?.[1]
        if (role)
          expect(role.length, `${s.school}: ${a}`).toBeLessThanOrEqual(40)
        const name = a.replace(/\s*\([^)]*\)$/, '')
        expect(ALUMNI_BLOCKLIST.has(name), `${s.school}: ${a}`).toBe(false)
        expect(a, `${s.school}: ${a}`).not.toMatch(
          /serial killer|murder|sex offender/i,
        )
      }
    }
  })

  it('no leftover wikitext markup in any text field', () => {
    for (const s of file!.schools) {
      for (const v of [
        s.mascot,
        s.nickname,
        s.division,
        s.conference,
        ...(s.alumni ?? []),
      ]) {
        if (v)
          expect(v, `${s.school}: ${v}`).not.toMatch(
            /[[\]{}<>|]|&nbsp;|&amp;|<ref/,
          )
      }
    }
  })

  it('most rows carry the headline stats (a parser regression would show here)', () => {
    const n = file!.schools.length
    const have = (k: keyof SchoolFacts) =>
      file!.schools.filter((s) => s[k] !== undefined).length
    const enrollment = file!.schools.filter(
      (s) => s.undergrad !== undefined || s.students !== undefined,
    ).length
    expect(enrollment).toBeGreaterThan(n * 0.95)
    expect(have('undergrad')).toBeGreaterThan(n * 0.75)
    expect(have('division')).toBeGreaterThan(n * 0.9)
    expect(have('mascot')).toBeGreaterThan(n * 0.7)
    expect(have('alumni')).toBeGreaterThan(n * 0.8)
    expect(have('founded')).toBeGreaterThan(n * 0.95)
  })
})
