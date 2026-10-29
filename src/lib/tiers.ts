/**
 * Difficulty-tier labels for the round header and results rows.
 *
 * The tier is shown BEFORE the guess as a fair expectation-setter ("🔴 Hard"
 * tells you a miss is forgivable); it carries no information about the town,
 * so it is not a hint. Tier definitions live in docs/DATA.md.
 */

import type { Difficulty } from '../types'

export const TIER_LABELS: Record<Difficulty, string> = {
  easy: '🟢 Easy',
  medium: '🟡 Medium',
  hard: '🔴 Hard',
}

export function tierLabel(difficulty: Difficulty): string {
  return TIER_LABELS[difficulty]
}
