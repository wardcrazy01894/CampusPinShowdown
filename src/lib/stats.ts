/**
 * Lifetime per-tier stats from the saved history — "how do I do on hard
 * towns?". Pure (no storage/DOM); Results reads the official history and
 * passes it in.
 *
 * Records written before `difficulty` was stored per round (PR #14) have no
 * tier on their results and are simply not counted here — the day count only
 * includes days that contribute to at least one tier.
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
  let days = 0
  for (const day of history) {
    let counted = false
    for (const r of day.results) {
      if (!r.difficulty) continue
      sums[r.difficulty].total += r.score
      sums[r.difficulty].n += 1
      counted = true
    }
    if (counted) days += 1
  }
  const stat = (d: Difficulty): TierStat | null =>
    sums[d].n === 0
      ? null
      : { avg: Math.round(sums[d].total / sums[d].n), rounds: sums[d].n }
  return {
    easy: stat('easy'),
    medium: stat('medium'),
    hard: stat('hard'),
    days,
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
