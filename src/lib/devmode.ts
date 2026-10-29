/**
 * Dev/testing modes, driven by URL query params (client-side only).
 *
 *   (none)     → normal: today's 5, progress persists across refreshes.
 *   ?reset     → same 5 for the day, but drop the current game on every refresh
 *                (replay the same set from round 1 — handy for debugging one
 *                set). History and streak are kept.
 *   ?fresh     → alias of ?reset.
 *   ?shuffle   → a brand-new RANDOM 5 on every refresh (try different things).
 *   ?random    → alias of ?shuffle.
 *   ?date=YYYY-MM-DD → play a specific day's puzzle (persists, no reset).
 *   ?celebrate → force the strong-finish celebration (confetti + cheer) on the
 *                results screen regardless of score, to preview/tune it.
 *
 * All helpers are pure (take the location.search string) so they're testable.
 */

/** True if saved progress should be cleared on this load. */
export function shouldStartFresh(search: string): boolean {
  const p = new URLSearchParams(search)
  return p.has('reset') || p.has('fresh') || p.has('shuffle') || p.has('random')
}

/** True if this load should pick a brand-new random set instead of the daily one. */
export function shouldShuffle(search: string): boolean {
  const p = new URLSearchParams(search)
  return p.has('shuffle') || p.has('random')
}

/**
 * True for the `?celebrate` dev flag — forces the results-screen celebration
 * (confetti + cheer) regardless of score, so it can be previewed and tuned
 * without having to actually play a strong game.
 */
export function isCelebrateTest(search: string): boolean {
  return new URLSearchParams(search).has('celebrate')
}
