/**
 * Deterministic daily town selection.
 *
 * GOAL: every player who loads the game on a given day sees the SAME 5 towns in
 * the SAME order, with NO backend. Each town gets a per-day rank — a hash of
 * `<seed>|<town id>` — the pool is sorted by that rank, and the fixed
 * difficulty plan (DIFFICULTY_PLAN) is filled from the front while preferring a
 * fresh state for each slot.
 *
 * ── Day boundary (read this) ─────────────────────────────────────────────────
 * The puzzle rolls over at midnight in the PLAYER's local timezone, like Wordle.
 * The date key is just the local calendar date, so everyone who plays on
 * 2026-10-29 gets the same 5 towns regardless of where they are. (`getDateKey`
 * takes an explicit IANA timezone for tests and for anything that needs
 * determinism.)
 *
 * ── Stability under dataset changes (read this) ──────────────────────────────
 * Ranks are per town, NOT a shuffle of the whole list, so adding or removing a
 * town leaves every other town's rank for every day untouched. A day's lineup
 * changes only if the new town out-ranks a current pick for one of that day's
 * slots (or a removed town WAS a pick). One subtlety: the fresh-state preference
 * means a new town in a state that day hasn't used yet can also win a slot over
 * a higher-ranked town whose state is taken — rare with ~46 states and 5
 * slots, and accepted. The dataset grows through the "add my
 * town" flow, so this matters: a whole-pool Fisher–Yates would re-roll TODAY's
 * puzzle under players mid-game on every data deploy (the resume logic then
 * restarts them on the new lineup — see resume.ts). A guard test pins this
 * property. See docs/PLAN.md.
 *
 * ── Recency cooldown (read this) ─────────────────────────────────────────────
 * Independent per-day draws repeat towns fast (five repeats in the first
 * eleven days, Norman two days running — birthday math on a 69-town easy
 * tier). From COOLDOWN_FROM_DATE_KEY on, `dailyLineup` walks the days in
 * order and excludes every town that appeared in the previous COOLDOWN_DAYS
 * lineups. Deterministic, no storage, same for everyone; the walk starts
 * COOLDOWN_DAYS before the switch-on date so the legacy puzzles just before
 * it count too, and the already-played days keep their lineups exactly. The
 * price (measured, docs/PLAN.md): a dataset change can now ripple into the
 * next few days' lineups as well — still rare at 14 days (today's lineup
 * changed in 2 of 30 simulated additions vs 1 of 30 without the cooldown),
 * which is why the window is 14 and not 21 or 28.
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

/** A town that appeared in the last N daily lineups is not eligible today. */
export const COOLDOWN_DAYS = 14

/**
 * First day the cooldown applies. Days before it keep the legacy
 * memoryless selection, so no puzzle anyone has already played is re-rolled
 * by the switch (puzzles #1–#12 were played without it).
 */
export const COOLDOWN_FROM_DATE_KEY = '2026-11-10'

/** `dateKey` shifted by `n` calendar days, in UTC so DST can't skip or repeat a day. */
export function addDays(dateKey: string, n: number): string {
  return new Date(Date.parse(dateKey + 'T00:00:00Z') + n * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/** The selection seed for a region's calendar day — the one format mode.ts
 *  and dailyLineup must agree on: "usa:2026-10-29". */
export function dateSeed(regionId: string, dateKey: string): string {
  return `${regionId}:${dateKey}`
}

/**
 * Returns the calendar day as "YYYY-MM-DD" — in `timeZone` when given,
 * otherwise in the runtime's local timezone (the player's). Pure given `now`
 * (+ timeZone).
 */
export function getDateKey(now: Date = new Date(), timeZone?: string): string {
  // Assemble from numeric parts rather than trusting a locale's short-date
  // pattern: ICU has changed `en-CA` output before (Chrome 110 briefly gave
  // M/D/YYYY), and a non-ISO key would seed a different puzzle for that browser
  // and blow up the streak math.
  const parts = new Intl.DateTimeFormat('en-US', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
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

/**
 * Deterministically pick `count` towns for a selection seed (e.g.
 * "usa:2026-10-29"), following DIFFICULTY_PLAN.
 *
 *  - Every town is ranked by hashStringToSeed(`${seed}|${id}`) (ties broken
 *    by id), so source-file order never matters and other towns' ranks don't
 *    move when one is added or removed. Same seed + same dataset ⇒ identical
 *    result in every browser. No Math.random().
 *  - Each slot takes the best-ranked town of its difficulty whose state is not
 *    yet in today's lineup; then any of its difficulty; then any town at all —
 *    so a full set is always returned.
 *  - `exclude` (the recency cooldown, see dailyLineup) removes towns from
 *    consideration; they come back only as the very last resort, when nothing
 *    else is left (tiny datasets, dev fixtures).
 *
 * @throws if the dataset has fewer than `count` towns, or `count` exceeds the plan.
 */
export function selectDailyTowns(
  all: Town[],
  seed: string,
  count: number = ROUNDS_PER_DAY,
  exclude: ReadonlySet<string> = new Set(),
): Town[] {
  if (count > DIFFICULTY_PLAN.length) {
    throw new Error(
      `A day has at most ${DIFFICULTY_PLAN.length} rounds (asked for ${count}).`,
    )
  }
  if (all.length < count) {
    throw new Error(
      `Need at least ${count} towns, got ${all.length}. Add more to public/towns.json.`,
    )
  }
  const rank = new Map(all.map((t) => [t.id, dayRank(seed, t.id)]))
  const pool = [...all].sort(
    (a, b) =>
      rank.get(a.id)! - rank.get(b.id)! ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  return fillByDifficulty(pool, count, exclude)
}

/**
 * The lineup for a region's calendar day WITH the recency cooldown: from
 * COOLDOWN_FROM_DATE_KEY on, towns picked in the previous COOLDOWN_DAYS days
 * are excluded. Computed by walking day by day from COOLDOWN_DAYS before the
 * switch-on date (those days use the legacy selection and seed the history),
 * so it is a pure function of (dataset, dateKey) — no storage, identical in
 * every browser. Days before the switch-on date return the legacy selection
 * unchanged. Cost is linear in the days since 2026-10-27 (~350 hashes and one
 * sort per day, ~0.15 ms); the walk is memoised per dataset array so a second
 * call (midnight rollover, tests) only extends it.
 */
export function dailyLineup(
  all: Town[],
  regionId: string,
  dateKey: string,
  count: number = ROUNDS_PER_DAY,
): Town[] {
  if (dateKey < COOLDOWN_FROM_DATE_KEY)
    return selectDailyTowns(all, dateSeed(regionId, dateKey), count)
  const walk = walkFor(all, regionId, count)
  const start = addDays(COOLDOWN_FROM_DATE_KEY, -COOLDOWN_DAYS)
  const index = Math.round(
    (Date.parse(dateKey + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) /
      86_400_000,
  )
  while (walk.history.length <= index) {
    const i = walk.history.length
    const d = addDays(start, i)
    const exclude =
      i < COOLDOWN_DAYS
        ? new Set<string>() // legacy days: seed the history, no cooldown
        : new Set(
            walk.history
              .slice(-COOLDOWN_DAYS)
              .flatMap((day) => day.map((t) => t.id)),
          )
    walk.history.push(
      selectDailyTowns(all, dateSeed(regionId, d), count, exclude),
    )
  }
  return walk.history[index]
}

interface Walk {
  regionId: string
  count: number
  /** Lineups from COOLDOWN_DAYS before COOLDOWN_FROM_DATE_KEY, one per day. */
  history: Town[][]
}
/** One walk per dataset array (identity): a fresh towns.json fetch starts over. */
const walks = new WeakMap<Town[], Walk[]>()
function walkFor(all: Town[], regionId: string, count: number): Walk {
  let list = walks.get(all)
  if (!list) walks.set(all, (list = []))
  let w = list.find((x) => x.regionId === regionId && x.count === count)
  if (!w) list.push((w = { regionId, count, history: [] }))
  return w
}

/** A town's position in the day's ordering. Pure; independent of every other town. */
export function dayRank(seed: string, townId: string): number {
  return hashStringToSeed(`${seed}|${townId}`)
}

function fillByDifficulty(
  pool: Town[],
  count: number,
  exclude: ReadonlySet<string>,
): Town[] {
  const plan = DIFFICULTY_PLAN.slice(0, count)
  const used = new Set<string>()
  const usedStates = new Set<string>()
  const chosen: Town[] = []
  const free = (t: Town) => !used.has(t.id) && !exclude.has(t.id)
  const freshState = (t: Town) => !usedStates.has(t.stateCode)

  for (const difficulty of plan) {
    const ofDifficulty = pool.filter(
      (t) => free(t) && t.difficulty === difficulty,
    )
    const pick =
      ofDifficulty.find(freshState) ??
      ofDifficulty[0] ??
      pool.find((t) => free(t) && freshState(t)) ??
      pool.find(free) ??
      // Last resort: everything eligible is on cooldown (tiny pools only).
      pool.find((t) => !used.has(t.id))
    if (!pick) {
      throw new Error(`Could not fill ${count} rounds from ${pool.length}.`)
    }
    used.add(pick.id)
    usedStates.add(pick.stateCode)
    chosen.push(pick)
  }
  return chosen
}
