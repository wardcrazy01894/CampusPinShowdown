import { describe, it, expect } from 'vitest'
import {
  DIFFICULTY_PLAN,
  EPOCH_DATE_KEY,
  ROUNDS_PER_DAY,
  getDateKey,
  isValidDateKey,
  hashStringToSeed,
  dayRank,
  puzzleNumber,
  selectDailyTowns,
  addDays,
  dateSeed,
  dailyLineup,
  COOLDOWN_DAYS,
  COOLDOWN_FROM_DATE_KEY,
} from './daily'
import type { Difficulty, Town } from '../types'

// Golden values — see the GOLDEN tests below before touching.
const GOLDEN_HASH = 604240846
const GOLDEN_RANK = -988247844
const GOLDEN_LINEUP = [
  'easy-002',
  'easy-005',
  'medium-009',
  'medium-003',
  'hard-007',
]

function town(id: string, stateCode: string, difficulty: Difficulty): Town {
  return {
    id,
    name: id,
    state: stateCode,
    stateCode,
    schools: ['U'],
    lat: 40,
    lng: -90,
    difficulty,
    source: 'manual',
    attribution: 'test',
  }
}

/** Twelve states so the fresh-state preference rarely has to compromise. */
const STATES = [
  'MI',
  'OH',
  'TX',
  'CA',
  'GA',
  'NY',
  'PA',
  'WA',
  'CO',
  'FL',
  'IL',
  'VA',
]

/** n towns per difficulty, spread across `states` round-robin. */
function makeTowns(perTier: number, states = STATES): Town[] {
  const out: Town[] = []
  for (const d of ['easy', 'medium', 'hard'] as const) {
    for (let i = 0; i < perTier; i++) {
      out.push(
        town(
          `${d}-${String(i).padStart(3, '0')}`,
          states[i % states.length],
          d,
        ),
      )
    }
  }
  return out
}

describe('getDateKey', () => {
  it('rolls over at midnight in the given timezone, DST-aware', () => {
    // June = EDT (UTC-4); Eastern midnight is 04:00 UTC.
    expect(
      getDateKey(new Date('2026-06-07T03:59:00Z'), 'America/New_York'),
    ).toBe('2026-06-06')
    expect(
      getDateKey(new Date('2026-06-07T04:00:00Z'), 'America/New_York'),
    ).toBe('2026-06-07')
    // Pacific is three hours behind.
    expect(
      getDateKey(new Date('2026-06-07T06:59:00Z'), 'America/Los_Angeles'),
    ).toBe('2026-06-06')
  })

  it('does not depend on a locale short-date pattern (formatToParts, not format)', () => {
    // ICU once made en-CA's short date M/D/YYYY (Chrome 110). Make `format`
    // return that and the key must still come out ISO (it must be assembled
    // from formatToParts). `format` is a getter on the prototype, so swap the
    // descriptor rather than spying on a plain method.
    const proto = Intl.DateTimeFormat.prototype
    const original = Object.getOwnPropertyDescriptor(proto, 'format')!
    Object.defineProperty(proto, 'format', {
      configurable: true,
      get: () => () => '6/7/2026',
    })
    try {
      expect(getDateKey(new Date('2026-06-07T12:00:00Z'), 'UTC')).toBe(
        '2026-06-07',
      )
    } finally {
      Object.defineProperty(proto, 'format', original)
    }
  })

  it('formats as YYYY-MM-DD in the local zone when no timezone is given', () => {
    expect(getDateKey(new Date('2026-06-07T12:00:00Z'))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    )
  })
})

describe('isValidDateKey', () => {
  it('accepts real calendar dates only', () => {
    expect(isValidDateKey('2026-10-29')).toBe(true)
    expect(isValidDateKey('2028-02-29')).toBe(true) // leap day
    expect(isValidDateKey('2026-02-30')).toBe(false)
    expect(isValidDateKey('2026-99-99')).toBe(false)
    expect(isValidDateKey('10/29/2026')).toBe(false)
    expect(isValidDateKey('')).toBe(false)
  })
})

describe('puzzleNumber', () => {
  it('numbers the launch day #1 and counts up daily', () => {
    expect(puzzleNumber(EPOCH_DATE_KEY)).toBe(1)
    expect(puzzleNumber('2026-10-30')).toBe(2)
    expect(puzzleNumber('2026-11-29')).toBe(32)
  })

  it('is stable across the DST change (UTC arithmetic)', () => {
    // US DST ends 2026-11-01; a local-time diff would be off by an hour → wrong day.
    expect(puzzleNumber('2026-11-01')).toBe(4)
    expect(puzzleNumber('2026-11-02')).toBe(5)
  })

  it('goes to zero and below for pre-launch dates (?date= overrides only)', () => {
    expect(puzzleNumber('2026-10-28')).toBe(0)
  })
})

describe('hashStringToSeed / dayRank', () => {
  it('hashes deterministically and distinguishes similar strings', () => {
    expect(hashStringToSeed('usa:2026-10-29')).toBe(
      hashStringToSeed('usa:2026-10-29'),
    )
    expect(hashStringToSeed('usa:2026-10-29')).not.toBe(
      hashStringToSeed('usa:2026-10-30'),
    )
  })

  it('GOLDEN: the hash is pinned — changing it re-rolls every past and future puzzle', () => {
    expect(hashStringToSeed('usa:2026-10-29')).toBe(GOLDEN_HASH)
    expect(dayRank('usa:2026-10-29', 'ann-arbor-mi')).toBe(GOLDEN_RANK)
  })
})

describe('selectDailyTowns', () => {
  const towns = makeTowns(10)

  it('returns exactly ROUNDS_PER_DAY distinct towns', () => {
    const picks = selectDailyTowns(towns, 'usa:2026-10-29')
    expect(picks).toHaveLength(ROUNDS_PER_DAY)
    expect(new Set(picks.map((t) => t.id)).size).toBe(ROUNDS_PER_DAY)
  })

  it('GOLDEN: the launch-day lineup for the fixture is pinned', () => {
    // If this changes, every player's puzzle for every day changes. Only
    // update it deliberately (and say so in the PR).
    expect(selectDailyTowns(towns, 'usa:2026-10-29').map((t) => t.id)).toEqual(
      GOLDEN_LINEUP,
    )
  })

  it('STABILITY: adding one town leaves almost every day untouched', () => {
    // The must-fix from PR #1 review: a whole-pool shuffle re-rolled TODAY's
    // puzzle under players on every dataset deploy. With per-town ranks, a new
    // town changes a day only when it out-ranks a current pick for a slot.
    // Same state as an existing town. (A town in a brand-new state can also
    // win a slot via the fresh-state preference when it out-ranks the current
    // pick — measured ~1 day in 7 on this fixture — the accepted, documented
    // cost of that rule; see the next test.)
    const grown = [...towns, town('hard-999', 'MI', 'hard')]
    let same = 0
    const DAYS = 60
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10)
      const a = selectDailyTowns(towns, `usa:${d}`).map((t) => t.id)
      const b = selectDailyTowns(grown, `usa:${d}`).map((t) => t.id)
      if (a.join() === b.join()) same++
    }
    // One new hard town among 11 can win the single hard slot ~1 day in 11.
    expect(same).toBeGreaterThanOrEqual(DAYS * 0.8)
  })

  it('STABILITY: a town in a brand-new state still leaves most days untouched', () => {
    const grown = [...towns, town('hard-998', 'AK', 'hard')]
    let same = 0
    const DAYS = 60
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10)
      const a = selectDailyTowns(towns, `usa:${d}`).map((t) => t.id)
      const b = selectDailyTowns(grown, `usa:${d}`).map((t) => t.id)
      if (a.join() === b.join()) same++
    }
    expect(same).toBeGreaterThanOrEqual(DAYS * 0.7)
  })

  it('STABILITY: removing a town that was not picked changes nothing for that day', () => {
    const picks = selectDailyTowns(towns, 'usa:2026-10-29')
    const notPicked = towns.find((t) => !picks.some((p) => p.id === t.id))!
    const without = towns.filter((t) => t.id !== notPicked.id)
    expect(
      selectDailyTowns(without, 'usa:2026-10-29').map((t) => t.id),
    ).toEqual(picks.map((t) => t.id))
  })

  it('is deterministic for the same seed and independent of input order', () => {
    const a = selectDailyTowns(towns, 'usa:2026-10-29').map((t) => t.id)
    const b = selectDailyTowns([...towns].reverse(), 'usa:2026-10-29').map(
      (t) => t.id,
    )
    expect(a).toEqual(b)
  })

  it('differs across days (different seeds)', () => {
    const a = selectDailyTowns(towns, 'usa:2026-10-29').map((t) => t.id)
    const b = selectDailyTowns(towns, 'usa:2026-10-30').map((t) => t.id)
    expect(a).not.toEqual(b)
  })

  it('follows the easy, easy, medium, medium, hard plan', () => {
    const picks = selectDailyTowns(towns, 'usa:2026-10-29')
    expect(picks.map((t) => t.difficulty)).toEqual(DIFFICULTY_PLAN)
  })

  it('prefers a fresh state for every slot when the pool allows it', () => {
    // With 12 states and 10 towns per tier, the first four slots can always
    // find a fresh state.
    for (const day of [
      '2026-10-29',
      '2026-11-05',
      '2026-12-25',
      '2027-01-01',
    ]) {
      const picks = selectDailyTowns(towns, `usa:${day}`)
      const first4 = picks.slice(0, 4).map((t) => t.stateCode)
      expect(new Set(first4).size, day).toBe(4)
    }
  })

  it('falls back to any town when a difficulty bucket is empty', () => {
    const noHard = towns.filter((t) => t.difficulty !== 'hard')
    const picks = selectDailyTowns(noHard, 'usa:2026-10-29')
    expect(picks).toHaveLength(5)
    expect(picks[4].difficulty).not.toBe('hard')
  })

  it('throws when asked for more rounds than the plan has (never silently caps)', () => {
    expect(() => selectDailyTowns(towns, 'usa:2026-10-29', 6)).toThrow(
      /at most 5/,
    )
  })

  it('throws when the dataset is too small', () => {
    expect(() => selectDailyTowns(towns.slice(0, 4), 'usa:2026-10-29')).toThrow(
      /at least 5/,
    )
  })
})

describe('recency cooldown (dailyLineup)', () => {
  // A pool big enough for the rule to be satisfiable (2 easy + 2 medium + 1
  // hard a day × 14 days < each tier), with 50 fake states.
  const mk = (i: number, difficulty: Difficulty): Town => ({
    id: `${difficulty}-${i}`,
    name: `${difficulty} ${i}`,
    state: `State ${i}`,
    stateCode: `S${(i * 7 + difficulty.length) % 50}`,
    schools: ['U'],
    lat: 40,
    lng: -90,
    difficulty,
    source: 'manual',
    attribution: 't',
  })
  const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
  const pool: Town[] = [
    ...range(40).map((i) => mk(i, 'easy')),
    ...range(40).map((i) => mk(i, 'medium')),
    ...range(20).map((i) => mk(i, 'hard')),
  ]
  const tiny: Town[] = (['easy', 'medium', 'hard'] as Difficulty[]).flatMap(
    (d) => range(3).map((i) => mk(i, d)),
  )
  const ids = (ts: Town[]) => ts.map((t) => t.id)
  const daysBetween = (a: string, b: string) =>
    (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000

  it('addDays / dateSeed are plain UTC date arithmetic and the seed format mode.ts uses', () => {
    expect(addDays('2026-11-10', -14)).toBe('2026-10-27')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-03-14', 0)).toBe('2027-03-14')
    expect(dateSeed('usa', '2026-11-10')).toBe('usa:2026-11-10')
  })

  it('selectDailyTowns honours an exclusion set, falling back to excluded towns only as a last resort', () => {
    const plain = selectDailyTowns(pool, 'usa:2026-12-01')
    const excluded = new Set(ids(plain))
    const next = selectDailyTowns(
      pool,
      'usa:2026-12-01',
      ROUNDS_PER_DAY,
      excluded,
    )
    expect(next).toHaveLength(ROUNDS_PER_DAY)
    expect(ids(next).some((id) => excluded.has(id))).toBe(false)
    // Exclude everything: the day must still fill (tiny datasets, dev modes).
    expect(
      selectDailyTowns(
        pool,
        'usa:2026-12-01',
        ROUNDS_PER_DAY,
        new Set(ids(pool)),
      ),
    ).toHaveLength(ROUNDS_PER_DAY)
  })

  it('before COOLDOWN_FROM_DATE_KEY the lineup is the legacy selection, unchanged', () => {
    const d = addDays(COOLDOWN_FROM_DATE_KEY, -1)
    expect(ids(dailyLineup(pool, 'usa', d))).toEqual(
      ids(selectDailyTowns(pool, dateSeed('usa', d))),
    )
    expect(ids(dailyLineup(pool, 'usa', EPOCH_DATE_KEY))).toEqual(
      ids(selectDailyTowns(pool, dateSeed('usa', EPOCH_DATE_KEY))),
    )
  })

  it('from COOLDOWN_FROM_DATE_KEY on, no town returns within COOLDOWN_DAYS — counting the legacy days just before', () => {
    expect(COOLDOWN_DAYS).toBe(14)
    const last = new Map<string, string>()
    const start = addDays(COOLDOWN_FROM_DATE_KEY, -COOLDOWN_DAYS)
    for (let i = 0; i < COOLDOWN_DAYS + 120; i++) {
      const d = addDays(start, i)
      const picks = dailyLineup(pool, 'usa', d)
      expect(picks, d).toHaveLength(ROUNDS_PER_DAY)
      expect(new Set(ids(picks)).size, d).toBe(ROUNDS_PER_DAY)
      if (d >= COOLDOWN_FROM_DATE_KEY)
        for (const t of picks) {
          const l = last.get(t.id)
          if (l)
            expect(daysBetween(l, d), `${t.id} on ${d}`).toBeGreaterThan(
              COOLDOWN_DAYS,
            )
        }
      for (const t of picks) last.set(t.id, d)
    }
  })

  it('still fills a day when the pool is too small for the window (last-resort fallback)', () => {
    const d = addDays(COOLDOWN_FROM_DATE_KEY, 20)
    expect(dailyLineup(tiny, 'usa', d)).toHaveLength(ROUNDS_PER_DAY)
  })

  it('is deterministic, independent of input order, and memoised per dataset array', () => {
    const d = addDays(COOLDOWN_FROM_DATE_KEY, 30)
    const a = ids(dailyLineup(pool, 'usa', d))
    const b = ids(dailyLineup([...pool].reverse(), 'usa', d))
    expect(a).toEqual(b)
    expect(ids(dailyLineup(pool, 'usa', d))).toEqual(a) // cached walk, same answer
    expect(ids(dailyLineup(pool, 'usa', addDays(d, 1)))).not.toEqual(a)
  })
})
