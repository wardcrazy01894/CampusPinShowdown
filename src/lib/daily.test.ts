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

/** n towns per difficulty, spread across `states` round-robin. */
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
    // Same state as an existing town: a new town in a brand-new state would
    // win the fresh-state preference every day it isn't already used, which is
    // the (accepted, documented) cost of that rule — not what this test guards.
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

  it('throws when the dataset is too small', () => {
    expect(() => selectDailyTowns(towns.slice(0, 4), 'usa:2026-10-29')).toThrow(
      /at least 5/,
    )
  })
})
