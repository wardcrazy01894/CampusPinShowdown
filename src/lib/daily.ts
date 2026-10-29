/**
 * Deterministic daily town selection.
 *
 * GOAL: every player who loads the game on a given day sees the SAME 5 towns in
 * the SAME order, with NO backend. Achieved by hashing the selection seed
 * (region + date) into a seed for a tiny PRNG, shuffling a COPY of the dataset
 * sorted by id, then filling the fixed difficulty plan (DIFFICULTY_PLAN) while
 * preferring a fresh state for each slot.
 *
 * ── Day boundary (read this) ─────────────────────────────────────────────────
 * The puzzle rolls over at midnight in the PLAYER's local timezone, like Wordle.
 * The date key is just the local calendar date, so everyone who plays on
 * 2026-10-29 gets the same 5 towns regardless of where they are. (`getDateKey`
 * takes an explicit IANA timezone for tests and for anything that needs
 * determinism.)
 *
 * ── Stability tradeoff ───────────────────────────────────────────────────────
 * Selection is a pure function of (seed, dataset). Adding/removing a town
 * changes the shuffle for every date — past and future puzzles shift. For a
 * friends game that's acceptable; if it ever matters, freeze per-date picks
 * into a committed manifest. See docs/PLAN.md.
 */

import type { Difficulty, Town } from '../types'

export const ROUNDS_PER_DAY = 5

/**
 * The difficulty shape of a daily game: two easy, two medium, one hard, in this
 * order (gentle warm-up → hardest finisher). Within each slot we prefer a town
 * whose STATE hasn't appeared yet today, so a day doesn't become three Ohio
 * towns. If a bucket runs short, the slot falls back to any remaining town.
 */
export const DIFFICULTY_PLAN: Difficulty[] = [
  'easy',
  'easy',
  'medium',
  'medium',
  'hard',
]

/**
 * Puzzle #1 is the launch day. Wordle-style numbering for the share card —
 * `puzzleNumber('2026-10-29') === 1`.
 */
export const EPOCH_DATE_KEY = '2026-10-29'

/**
 * Returns the calendar day as "YYYY-MM-DD" — in `timeZone` when given,
 * otherwise in the runtime's local timezone (the player's). Uses the en-CA
 * locale, which formats as YYYY-MM-DD. Pure given `now` (+ timeZone).
 */
export function getDateKey(now: Date = new Date(), timeZone?: string): string {
  return new Intl.DateTimeFormat(
    'en-CA',
    timeZone ? { timeZone } : undefined,
  ).format(now)
}

/**
 * True if `key` is a REAL calendar date in YYYY-MM-DD form. A format-only
 * regex lets impossible dates through (?date=2026-99-99, 2026-02-30): those
 * later produce an Invalid Date inside the streak math, which throws
 * RangeError on game completion. The UTC round-trip catches both invalid
 * dates and silent rollovers (2026-02-30 → Mar 2).
 */
export function isValidDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const d = new Date(key + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key
}

/**
 * Wordle-style puzzle number: days since EPOCH_DATE_KEY, 1-based. Dates before
 * the epoch (only reachable via ?date=) go to zero and negative — fine for a
 * dev override, never shown for the official daily. UTC arithmetic so DST can
 * never produce an off-by-one.
 */
export function puzzleNumber(dateKey: string): number {
  const ms =
    new Date(dateKey + 'T00:00:00Z').getTime() -
    new Date(EPOCH_DATE_KEY + 'T00:00:00Z').getTime()
  return Math.round(ms / 86_400_000) + 1
}

/**
 * cyrb53 string hash → 32-bit seed. Fast, dependency-free, well-distributed.
 * https://stackoverflow.com/a/52171480
 */
export function hashStringToSeed(str: string): number {
  let h1 = 0xdeadbeef ^ 0
  let h2 = 0x41c6ce57 ^ 0
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0) ^ (h1 >>> 0)
}

/** mulberry32 — tiny deterministic PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministically pick `count` towns for a selection seed (e.g.
 * "usa:2026-10-29"), following DIFFICULTY_PLAN.
 *
 *  - The list is first sorted by `id` so source-file order never matters (only
 *    membership does).
 *  - Fisher–Yates shuffle driven by a seed-derived mulberry32. Same seed + same
 *    dataset ⇒ identical result in every browser. No Math.random().
 *  - Each slot takes the first shuffled town of its difficulty whose state is
 *    not yet in today's lineup; then any of its difficulty; then any town at
 *    all — so a full set is always returned.
 *
 * @throws if the dataset has fewer than `count` towns.
 */
export function selectDailyTowns(
  all: Town[],
  seed: string,
  count: number = ROUNDS_PER_DAY,
): Town[] {
  if (all.length < count) {
    throw new Error(
      `Need at least ${count} towns, got ${all.length}. Add more to public/towns.json.`,
    )
  }
  const pool = [...all].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const rand = mulberry32(hashStringToSeed(seed))
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return fillByDifficulty(pool, count)
}

function fillByDifficulty(pool: Town[], count: number): Town[] {
  const plan = DIFFICULTY_PLAN.slice(0, count)
  const used = new Set<string>()
  const usedStates = new Set<string>()
  const chosen: Town[] = []
  const free = (t: Town) => !used.has(t.id)
  const freshState = (t: Town) => !usedStates.has(t.stateCode)

  for (const difficulty of plan) {
    const ofDifficulty = pool.filter(
      (t) => free(t) && t.difficulty === difficulty,
    )
    const pick =
      ofDifficulty.find(freshState) ??
      ofDifficulty[0] ??
      pool.find((t) => free(t) && freshState(t)) ??
      pool.find(free)
    if (!pick) {
      throw new Error(`Could not fill ${count} rounds from ${pool.length}.`)
    }
    used.add(pick.id)
    usedStates.add(pick.stateCode)
    chosen.push(pick)
  }
  return chosen
}
