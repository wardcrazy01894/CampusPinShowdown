/**
 * Dataset search helpers — used by the "is my college town in the game?"
 * lookup. Pure and unit-tested; the React component is a thin shell over these.
 * A query matches a town by its name, its "Name, ST" form, its state, or any of
 * its schools, so "Michigan" finds Ann Arbor and "Wolverines"-style nicknames
 * don't (they aren't in the data).
 */

import type { Town } from '../types'

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Every string a town can be found by, normalized. */
function keys(t: Town): string[] {
  return [t.name, `${t.name} ${t.stateCode}`, t.state, ...t.schools].map(
    normalize,
  )
}

/**
 * Substring search over towns, ranked: name-prefix matches first, then any
 * prefix match (state/school), then by how early the match occurs, then
 * alphabetically. Returns [] for <2-char queries.
 */
export function searchTowns(towns: Town[], query: string, limit = 12): Town[] {
  const q = normalize(query)
  if (q.length < 2) return []
  const scored: Array<{ town: Town; rank: number; idx: number }> = []
  for (const town of towns) {
    const ks = keys(town)
    let best: { rank: number; idx: number } | null = null
    ks.forEach((k, i) => {
      const idx = k.indexOf(q)
      if (idx === -1) return
      // rank 0: the town name itself starts with the query; 1: another key
      // starts with it; 2: substring anywhere.
      const rank = idx === 0 ? (i === 0 ? 0 : 1) : 2
      if (!best || rank < best.rank || (rank === best.rank && idx < best.idx))
        best = { rank, idx }
    })
    if (best) scored.push({ town, ...(best as { rank: number; idx: number }) })
  }
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.idx - b.idx ||
      a.town.name.localeCompare(b.town.name),
  )
  return scored.slice(0, limit).map((s) => s.town)
}

/** True if a town with this (normalized) name — or a school by this name — is in the dataset. */
export function isIncluded(towns: Town[], query: string): boolean {
  const q = normalize(query)
  if (!q) return false
  return towns.some((t) =>
    [t.name, `${t.name} ${t.stateCode}`, ...t.schools].some(
      (k) => normalize(k) === q,
    ),
  )
}
