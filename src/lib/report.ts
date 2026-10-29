/**
 * Bug reporting + "add my town" requests.
 *
 * The app is static with no backend, so reports open a PREFILLED GitHub
 * "new issue" page with the user's text and some context. (KnowYourCity has a
 * Cloudflare Worker that files issues directly; port it if this ever needs
 * one-click reporting — see BACKLOG.md.)
 */

export const REPO_URL = 'https://github.com/wardcrazy01894/CampusPinShowdown'

export interface ReportContext {
  date?: string
}

/**
 * Prefill text for a request to ADD a town (from the "is my town in the game?"
 * search). Names the town when we have it so the request is actionable.
 */
export function addTownRequestMessage(name: string): string {
  // Strip embedded double-quotes so they can't nest inside the wrapping quotes.
  const town = name.replace(/"/g, '').trim()
  return town
    ? `Please add "${town}" to the game.`
    : `I'd like to request a college town be added to the game: `
}

/** Prefilled GitHub new-issue URL. */
export function bugReportUrl(ctx: ReportContext = {}, message = ''): string {
  const href = typeof location !== 'undefined' ? location.href : ''
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const title = '[bug] ' + (message.split('\n')[0] || '').slice(0, 80)
  const body = [
    '**What happened?**',
    '',
    message || '',
    '',
    '---',
    `Puzzle: ${ctx.date ?? '?'}`,
    `URL: ${href}`,
    `Browser: ${ua}`,
    '',
    '_Tip: run `cpsDumpLogs()` in the browser console (F12) and paste the output._',
  ].join('\n')
  return `${REPO_URL}/issues/new?title=${encodeURIComponent(
    title,
  )}&body=${encodeURIComponent(body)}`
}
