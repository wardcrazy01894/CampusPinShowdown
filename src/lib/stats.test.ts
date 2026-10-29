import { describe, it, expect } from 'vitest'
import { tierStats, formatTierStats } from './stats'
import type { DayRecord } from '../types'

const day = (
  dateKey: string,
  rounds: Array<[score: number, difficulty?: 'easy' | 'medium' | 'hard']>,
): DayRecord => ({
  dateKey,
  totalScore: rounds.reduce((a, [s]) => a + s, 0),
  results: rounds.map(([score, difficulty]) => ({
    distanceMeters: 0,
    score,
    ...(difficulty ? { difficulty } : {}),
  })),
})

describe('tierStats', () => {
  it('averages per tier across days and counts contributing days', () => {
    const s = tierStats([
      day('2026-10-29', [
        [100, 'easy'],
        [80, 'easy'],
        [60, 'medium'],
        [40, 'medium'],
        [10, 'hard'],
      ]),
      day('2026-10-30', [
        [90, 'easy'],
        [70, 'easy'],
        [50, 'medium'],
        [30, 'medium'],
        [20, 'hard'],
      ]),
    ])
    expect(s).toEqual({
      easy: { avg: 85, rounds: 4 },
      medium: { avg: 45, rounds: 4 },
      hard: { avg: 15, rounds: 2 },
      days: 2,
    })
  })

  it('ignores legacy records with no per-round difficulty (and does not count their day)', () => {
    const s = tierStats([
      day('2026-10-29', [[100], [80], [60], [40], [10]]), // pre-PR-14 record
      day('2026-10-30', [[100, 'hard']]),
    ])
    expect(s).toEqual({
      easy: null,
      medium: null,
      hard: { avg: 100, rounds: 1 },
      days: 1,
    })
  })

  it('is all-null with zero days for an empty history', () => {
    expect(tierStats([])).toEqual({
      easy: null,
      medium: null,
      hard: null,
      days: 0,
    })
  })
})

describe('formatTierStats', () => {
  it('lists the tiers that have data, then the day count', () => {
    expect(
      formatTierStats({
        easy: { avg: 82, rounds: 10 },
        medium: { avg: 61, rounds: 10 },
        hard: { avg: 34, rounds: 5 },
        days: 12,
      }),
    ).toBe('🟢 82 · 🟡 61 · 🔴 34 avg · 12 days')
    expect(
      formatTierStats({
        easy: null,
        medium: null,
        hard: { avg: 100, rounds: 1 },
        days: 1,
      }),
    ).toBe('🔴 100 avg · 1 day')
    expect(formatTierStats(tierStats([]))).toBe('')
  })
})
