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

  it('rounds averages to the nearest integer', () => {
    const s = tierStats([
      day('2026-10-29', [
        [100, 'easy'],
        [81, 'easy'],
      ]),
    ])
    expect(s.easy).toEqual({ avg: 91, rounds: 2 }) // 90.5 → 91
  })

  it('counts a changed-lineup replay’s rounds but the calendar day only once', () => {
    const s = tierStats([
      { ...day('2026-10-29', [[100, 'hard']]), lineup: 'aaaa' },
      { ...day('2026-10-29', [[50, 'hard']]), lineup: 'bbbb' },
    ])
    expect(s.hard).toEqual({ avg: 75, rounds: 2 })
    expect(s.days).toBe(1)
  })

  it('skips corrupt rows (unknown tier, non-finite score) instead of throwing', () => {
    const corrupt = {
      dateKey: '2026-10-29',
      totalScore: 0,
      results: [
        { distanceMeters: 0, score: 100, difficulty: 'legendary' },
        { distanceMeters: 0, score: Number.NaN, difficulty: 'easy' },
        { distanceMeters: 0, score: 40, difficulty: 'easy' },
      ],
    } as unknown as DayRecord
    expect(() => tierStats([corrupt])).not.toThrow()
    expect(tierStats([corrupt])).toEqual({
      easy: { avg: 40, rounds: 1 },
      medium: null,
      hard: null,
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
