/**
 * Dataset search helpers — used by the "is my school in the game?" lookup.
 * Pure and unit-tested; the React component is a thin shell over these.
 *
 * The search is over SCHOOL NAMES only, and returns school names only. The
 * town and state are the answer to a round, so they are neither matched on
 * nor returned: that is what lets the lookup be offered on every screen,
 * mid-round included (owner: "type a school and see if it's in the game,
 * shouldn't be a spoiler"). Nicknames ("Wolverines") aren't in the data and
 * don't match.
 */

import type { Town } from '../types'

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Every distinct school in the dataset (first spelling wins). */
function allSchools(towns: Town[]): Map<string, string> {
  const byKey = new Map<string, string>()
  for (const t of towns)
    for (const school of t.schools) {
      const key = normalize(school)
      if (key && !byKey.has(key)) byKey.set(key, school)
    }
  return byKey
}

/** How many distinct schools the dataset has. */
export function schoolCount(towns: Town[]): number {
  return allSchools(towns).size
}

/**
 * Every school whose name contains the query, ranked: names that START with
 * it first, then by how early the match occurs, then alphabetically. Returns
 * [] for <2-char queries. Not capped — the caller decides how many to show.
 */
export function searchSchools(towns: Town[], query: string): string[] {
  const q = normalize(query)
  if (q.length < 2) return []
  const hits: Array<{ school: string; idx: number }> = []
  for (const [key, school] of allSchools(towns)) {
    const idx = key.indexOf(q)
    if (idx !== -1) hits.push({ school, idx })
  }
  hits.sort((a, b) => a.idx - b.idx || a.school.localeCompare(b.school))
  return hits.map((h) => h.school)
}
