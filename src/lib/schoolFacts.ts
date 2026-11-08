/**
 * School facts for the post-guess card: loading public/schools.json (once,
 * lazily — the first reveal of the day triggers it) and turning a row into
 * the short lines the card shows. Pure except for loadSchoolFacts; unit-tested
 * in schoolFacts.test.ts. The data contract is types.ts:SchoolFacts and the
 * pipeline is scripts/build-schools.mjs (docs/DATA.md §School facts).
 *
 * Failure is silent by design: no facts → no card. The game never waits on
 * or breaks over this file.
 */

import type { SchoolFacts, SchoolsFile } from '../types'
import { log } from './log'

/** URL of the bundled school facts, next to towns.json under the Vite base. */
export function schoolsUrl(): string {
  return `${import.meta.env.BASE_URL}schools.json`
}

let pending: Promise<SchoolsFile | null> | null = null

/**
 * The parsed file, shared by every caller; null when it cannot be loaded (a
 * failed load is not cached, so the next reveal tries again).
 */
export function loadSchoolFacts(): Promise<SchoolsFile | null> {
  if (!pending) {
    pending = fetchFile().then((file) => {
      if (!file) pending = null
      return file
    })
  }
  return pending
}

/** Test hook: forget the shared promise so each test starts cold. */
export function resetSchoolFactsCache(): void {
  pending = null
}

async function fetchFile(): Promise<SchoolsFile | null> {
  const url = schoolsUrl()
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const file = (await r.json()) as SchoolsFile
    if (!Array.isArray(file?.schools)) throw new Error('malformed')
    log.info('SchoolFacts', `loaded ${file.schools.length} schools`)
    return file
  } catch (e) {
    log.warn('SchoolFacts', `could not load ${url}`, { error: String(e) })
    return null
  }
}

/** The row for a prompt school (exact name), or undefined. */
export function findSchoolFacts(
  file: SchoolsFile | null | undefined,
  school: string,
): SchoolFacts | undefined {
  return file?.schools.find((s) => s.school === school)
}

const n = (x: number) => x.toLocaleString('en-US')

/** "34,184 undergrad · 8,271 grad (fall 2025)", or "23,150 students (…)" when
 *  only the total is known; '' when nothing is. */
export function formatEnrollment(f: SchoolFacts): string {
  const parts: string[] = []
  if (
    f.undergrad === undefined &&
    f.postgrad === undefined &&
    f.students !== undefined
  )
    parts.push(`${n(f.students)} students`)
  if (f.undergrad !== undefined) parts.push(`${n(f.undergrad)} undergrad`)
  if (f.postgrad !== undefined)
    parts.push(
      f.undergrad !== undefined
        ? `${n(f.postgrad)} grad`
        : `${n(f.postgrad)} grad students`,
    )
  if (!parts.length) return ''
  const asOf = f.enrollmentAsOf ? ` (${f.enrollmentAsOf})` : ''
  return parts.join(' · ') + asOf
}

/** "NCAA Division I FBS" → "D-I FBS"; "NCAA Division III" → "D-III"; NAIA stays. */
function shortDivision(division: string): string {
  return division
    .replace(/^NCAA\s+Division\s+/i, 'D-')
    .replace(/\s+independent$/i, ' independent')
    .trim()
}

/** "Red Raiders · Big 12 · D-I FBS" from whatever of the three is known. */
export function formatAthletics(f: SchoolFacts): string {
  const parts: string[] = []
  if (f.nickname) parts.push(f.nickname)
  if (f.conference) parts.push(f.conference)
  if (f.division) parts.push(shortDivision(f.division))
  return parts.join(' · ')
}

/** "#186 National Universities (U.S. News 2026)" — or "#3 in its region" for
 *  the regional lists (Wikipedia records one regional rank without the list
 *  name) — or ''. */
export function formatRanking(f: SchoolFacts, edition: number): string {
  if (!f.ranking) return ''
  const list = f.ranking.list === 'Regional' ? 'in its region' : f.ranking.list
  return `#${f.ranking.rank} ${list} (U.S. News ${edition})`
}

export interface FactChip {
  icon: string
  text: string
}

/**
 * The stat lines of the card, in a fixed order, skipping anything unknown:
 * type + founding year, enrollment, athletics, mascot, U.S. News rank.
 */
export function factChips(f: SchoolFacts, edition: number): FactChip[] {
  const founded = f.founded !== undefined ? `founded ${f.founded}` : ''
  const identity = f.type
    ? [f.type, founded].filter(Boolean).join(' · ')
    : founded && `Founded ${f.founded}`
  const chips: FactChip[] = [
    { icon: '🏛️', text: identity || '' },
    { icon: '🎓', text: formatEnrollment(f) },
    { icon: '🏟️', text: formatAthletics(f) },
    { icon: '🦅', text: f.mascot ? `Mascot: ${f.mascot}` : '' },
    { icon: '🏅', text: formatRanking(f, edition) },
  ]
  return chips.filter((c) => c.text)
}

/** The English Wikipedia URL for an article title (the card's credit link). */
export function wikipediaUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%3A/g, ':')}`
}
