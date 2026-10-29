/**
 * Lifetime per-tier stats from the saved history — "how do I do on hard
 * towns?". Pure (no storage/DOM); Results reads the official history and
 * passes it in.
 *
 * Records written before `difficulty` was stored per round (PR #14) have no
 * tier on their results and are simply not counted here — the day count only
 * includes days that contribute to at least one tier. A changed-lineup REPLAY
 * adds a second record for the same date: its rounds were really played, so
 * they count toward the averages, but `days` counts distinct calendar dates.
 * Defensive against a hand-edited/corrupt save: unknown tiers and non-finite
 * scores are skipped rather than thrown.
 */

import type { DayRecord, Difficulty } from '../types'

export interface TierStat {
  /** Mean round score for the tier, rounded to an integer. */
  avg: number
  /** Rounds counted. */
  rounds: number
}

export interface TierStats {
  easy: TierStat | null
  medium: TierStat | null
  hard: TierStat | null
  /** Official days with at least one tiered round. */
  days: number
}

export function tierStats(history: DayRecord[]): TierStats {
  const sums: Record<Difficulty, { total: number; n: number }> = {
    easy: { total: 0, n: 0 },
    medium: { total: 0, n: 0 },
    hard: { total: 0, n: 0 },
  }
  const days = new Set<string>()
  for (const day of history) {
    for (const r of day.results) {
      if (!r.difficulty || !(r.difficulty in sums)) continue
      if (!Number.isFinite(r.score)) continue
      sums[r.difficulty].total += r.score
      sums[r.difficulty].n += 1
      days.add(day.dateKey)
    }
  }
  const stat = (d: Difficulty): TierStat | null =>
    sums[d].n === 0
      ? null
      : { avg: Math.round(sums[d].total / sums[d].n), rounds: sums[d].n }
  return {
    easy: stat('easy'),
    medium: stat('medium'),
    hard: stat('hard'),
    days: days.size,
  }
}

/** "🟢 82 · 🟡 61 · 🔴 34 avg · 12 days" — tiers with no rounds yet are
 *  skipped; empty string when nothing is counted. */
export function formatTierStats(s: TierStats): string {
  const parts: string[] = []
  if (s.easy) parts.push(`🟢 ${s.easy.avg}`)
  if (s.medium) parts.push(`🟡 ${s.medium.avg}`)
  if (s.hard) parts.push(`🔴 ${s.hard.avg}`)
  if (parts.length === 0) return ''
  return `${parts.join(' · ')} avg · ${s.days} ${s.days === 1 ? 'day' : 'days'}`
}
