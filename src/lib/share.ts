/**
 * Share string — the Wordle-style clipboard text for a finished day. Pure (no
 * DOM) so it's unit-testable in the Node env; Results.tsx supplies the URL.
 */

import type { RoundResult } from '../types'
import { MAX_ROUND_SCORE, scoreEmoji } from './scoring'
import { ROUNDS_PER_DAY, puzzleNumber } from './daily'

/**
 * Builds the clipboard share text from a finished day's results:
 *
 *   📍 CampusPin Showdown #12
 *   2026-11-09 · 412/500
 *   💯🟩🟨🟧⬛        (a perfect 100 gets the day's special emoji)
 *   💡 2 hints           (only when a region hint was taken)
 *   https://…/            (only when `url` is given)
 */
export function buildShareString(
  dateKey: string,
  results: RoundResult[],
  totalScore: number,
  url?: string,
): string {
  const maxTotal = ROUNDS_PER_DAY * MAX_ROUND_SCORE
  const bar = results.map((r) => scoreEmoji(r.score, dateKey)).join('')
  const lines = [
    `📍 CampusPin Showdown #${puzzleNumber(dateKey)}`,
    `${dateKey} · ${totalScore.toLocaleString('en-US')}/${maxTotal.toLocaleString('en-US')}`,
    bar,
  ]
  // Hints are an honest part of the card: say how many rounds used one.
  const hints = results.filter((r) => r.hinted).length
  if (hints > 0) lines.push(`💡 ${hints} ${hints === 1 ? 'hint' : 'hints'}`)
  if (url) lines.push(url)
  return lines.join('\n')
}
