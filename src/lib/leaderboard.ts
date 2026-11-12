/**
 * Daily leaderboard — client side (ported from KnowYourCity; one nationwide
 * board).
 *
 * On finishing the OFFICIAL daily, the app submits the day's total to the
 * leaderboard Worker (worker/leaderboard.mjs) and shows "you placed Xth of Y
 * today". Identity is an anonymous random UUID kept in localStorage
 * (`cps:clientId`) — or, when signed in (src/lib/account.ts), the account:
 * the submission then carries the session token and the score is the
 * account's, one row across all its devices, shown under its display name.
 *
 * INTEGRITY: only the official daily counts. Shuffle (?shuffle) and date
 * overrides (?date=) are never submitted — the `official` flag from
 * resolveMode (src/lib/mode.ts) gates it here.
 *
 * GRACEFUL: every failure path (endpoint unset, offline, non-official game,
 * bad response) resolves to `null` so Results simply omits the line — the
 * leaderboard can never block or break the game.
 */

import { log } from './log'
// Type-only (erased at build), so no import cycle with account.ts.
import type { RoundTuple } from './account'

/** The one board today. Column is in the worker's primary key so a second
 *  region later is independent by construction. */
export const BOARD = 'usa'

const CLIENT_ID_KEY = 'cps:clientId'
const CACHE_PREFIX = 'cps:lb:v1'

/** A per-player streak computed server-side (keyed by the anonymous device id). */
export interface Streak {
  current: number
  best: number
}

export interface Standing {
  /** 1-based competition rank (ties share a rank). */
  rank: number
  /** Distinct players on the board for this day. */
  total: number
  /** The player's server-side streak after this submission, when available. */
  streak?: Streak
}

/**
 * The streak to DISPLAY given the local one and (maybe) the server one: the
 * larger of each field. The server table is empty when the leaderboard first
 * turns on and misses any day a submit failed, so taking the server value
 * blindly would drop a real streak; the local one only grows by playing, so
 * the max is honest. Pure.
 */
export function mergeStreak(local: Streak, server?: Streak | null): Streak {
  if (!server) return local
  return {
    current: Math.max(local.current, server.current),
    best: Math.max(local.best, server.best),
  }
}

/** Only show a "top X%" once the field is big enough for it to mean anything. */
export const PERCENTILE_MIN_TOTAL = 20

/** Random id used when crypto.randomUUID or storage is unavailable. */
function fallbackId(): string {
  return (
    'cps-' +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  ).slice(0, 36)
}

/** The stable anonymous device id, created once and reused. */
export function getClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY)
    if (existing) return existing
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : fallbackId()
    localStorage.setItem(CLIENT_ID_KEY, id)
    return id
  } catch {
    // Storage blocked (private mode) — degrade to an ephemeral id.
    return fallbackId()
  }
}

/** English ordinal: 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/** "Top X%" for a rank within a field — rank 1 of 100 → 1, clamped to ≥1. */
export function percentile(rank: number, total: number): number {
  if (total <= 0) return 100
  return Math.min(100, Math.max(1, Math.round((rank / total) * 100)))
}

/** Human standing line for the Results screen. Pure. */
export function formatStanding({ rank, total }: Standing): string {
  if (total <= 1) return 'You’re the first to finish today!'
  const base = `You placed ${ordinal(rank)} of ${total.toLocaleString(
    'en-US',
  )} today`
  return total >= PERCENTILE_MIN_TOTAL
    ? `${base} · top ${percentile(rank, total)}%`
    : base
}

// The cache (and thus the once-per-day no-re-POST guard) is keyed by LINEUP
// too: a reload of the same completion is served from cache, but a replay
// against a CHANGED official set has a different lineup → cache miss → it
// submits a new row.
const cacheKey = (dateKey: string, lineup: string) =>
  `${CACHE_PREFIX}:${BOARD}:${dateKey}:${lineup}`

/** Read a previously-returned standing for this day + lineup, or null. */
export function readStanding(dateKey: string, lineup: string): Standing | null {
  try {
    const raw = localStorage.getItem(cacheKey(dateKey, lineup))
    if (!raw) return null
    const s = JSON.parse(raw) as Standing
    return typeof s?.rank === 'number' && typeof s?.total === 'number'
      ? s
      : null
  } catch {
    return null
  }
}

function writeStanding(dateKey: string, lineup: string, s: Standing): void {
  try {
    localStorage.setItem(cacheKey(dateKey, lineup), JSON.stringify(s))
  } catch {
    /* best-effort */
  }
}

interface SubmitArgs {
  dateKey: string
  score: number
  /** Hash of the played lineup (progress.ts:lineupHash). */
  lineup: string
  /** True only for the real daily — false for shuffle / date override. */
  official: boolean
  /** Cloudflare Turnstile token, when the widget is enabled (not wired yet). */
  turnstileToken?: string
  /** Session token when signed in (account.ts) — the score is then the
   *  account's rather than this device's. */
  token?: string
  /** Each round's pin and points (sync.ts:roundsOf), so the account's other
   *  devices can show this finished day. */
  rounds?: RoundTuple[]
  /** Submit even when a standing is cached for this day + lineup (sync.ts
   *  handing a day played before signing in to the account). */
  force?: boolean
}

/** The JSON body POSTed to the leaderboard endpoint. Pure + testable. */
export function buildSubmitPayload(args: SubmitArgs) {
  return {
    board: BOARD,
    date: args.dateKey,
    score: args.score,
    clientId: getClientId(),
    lineup: args.lineup,
    rounds: args.rounds,
    token: args.token,
    turnstileToken: args.turnstileToken,
  }
}

/**
 * Submit today's official score and resolve the player's standing — or `null`
 * when the leaderboard shouldn't/can't run. A cached standing short-circuits
 * the network so a reload doesn't re-POST; the Worker UPSERT is idempotent
 * (keep-max) so even a racing duplicate POST is harmless.
 */
export async function submitDailyScore(
  args: SubmitArgs,
): Promise<Standing | null> {
  if (!args.official) return null
  const endpoint = import.meta.env.VITE_LEADERBOARD_ENDPOINT
  if (!endpoint) return null

  const cached = args.force ? null : readStanding(args.dateKey, args.lineup)
  if (cached) return cached

  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSubmitPayload(args)),
    })
    if (!r.ok) {
      // Surface the status AND the server's reason so a rejected submit is
      // diagnosable from the log buffer (window.cpsDumpLogs()).
      const body = await r.text().catch(() => '')
      log.warn('leaderboard', 'submit rejected', {
        status: r.status,
        lineup: args.lineup,
        body: body.slice(0, 200),
      })
      return null
    }
    const data = (await r.json().catch(() => null)) as Standing | null
    if (typeof data?.rank !== 'number' || typeof data?.total !== 'number') {
      log.warn('leaderboard', 'submit: unexpected response shape', { data })
      return null
    }
    const standing: Standing = { rank: data.rank, total: data.total }
    if (
      data.streak &&
      typeof data.streak.current === 'number' &&
      typeof data.streak.best === 'number'
    )
      standing.streak = { current: data.streak.current, best: data.streak.best }
    writeStanding(args.dateKey, args.lineup, standing)
    log.info('leaderboard', 'score submitted', {
      rank: standing.rank,
      total: standing.total,
    })
    return standing
  } catch (e) {
    log.warn('leaderboard', 'submit failed (network)', { error: String(e) })
    return null
  }
}

export interface LeaderboardData {
  /** Distinct players on the board for the day. */
  total: number
  /** The day's scores, highest first, capped at the server's TOP_LIMIT. */
  scores: number[]
  /** Parallel to `scores`: a signed-in player's display name, '' for an
   *  anonymous one. Absent from a worker that predates accounts. */
  names?: string[]
}

/**
 * Fetch the day's board (top scores + total, with the display names of
 * signed-in players). Read-only — the server never returns ids, usernames or
 * tokens. Resolves `null` when the
 * leaderboard is off/unavailable so the caller shows a friendly empty state.
 */
export async function fetchLeaderboard(
  dateKey: string,
): Promise<LeaderboardData | null> {
  const endpoint = import.meta.env.VITE_LEADERBOARD_ENDPOINT
  if (!endpoint) return null
  try {
    const u = new URL(endpoint)
    u.searchParams.set('board', BOARD)
    u.searchParams.set('date', dateKey)
    const r = await fetch(u.toString())
    if (!r.ok) {
      log.warn('leaderboard', 'read rejected', { status: r.status })
      return null
    }
    const data = (await r.json().catch(() => null)) as LeaderboardData | null
    if (
      !data ||
      !Array.isArray(data.scores) ||
      typeof data.total !== 'number'
    ) {
      log.warn('leaderboard', 'read: unexpected response shape', { data })
      return null
    }
    // Keep score and name paired: drop a malformed score WITH its name.
    const names = Array.isArray(data.names) ? data.names : []
    const rows = data.scores
      .map((score, i) => ({ score, name: names[i] }))
      .filter((r) => typeof r.score === 'number')
    return {
      total: data.total,
      scores: rows.map((r) => r.score),
      names: rows.map((r) => (typeof r.name === 'string' ? r.name : '')),
    }
  } catch (e) {
    log.warn('leaderboard', 'read failed (network)', { error: String(e) })
    return null
  }
}

/**
 * Recompute the player's standing for DISPLAY from a fresh read of the board.
 * The submit-time standing is cached write-once, so "Nth of Y" would otherwise
 * freeze at the moment the player finished. `total` is always fresh; `rank` is
 * exact when the player's score is within the returned top-N window (every
 * higher score is then in the window), else the cached rank floored at
 * window + 1. Pure.
 */
export function refreshStanding(
  cached: Standing,
  fresh: LeaderboardData,
  yourScore: number,
): Standing {
  const total = Math.max(fresh.total, 1)
  const returned = fresh.scores.length
  const greater = fresh.scores.filter((s) => s > yourScore).length
  const capped = returned < fresh.total
  const smallestReturned = returned > 0 ? Math.min(...fresh.scores) : Infinity
  const inWindow = !capped || yourScore >= smallestReturned
  const rank = inWindow ? greater + 1 : Math.max(cached.rank, returned + 1)
  const out: Standing = { rank, total }
  if (cached.streak) out.streak = cached.streak
  return out
}

export interface LeaderboardRow {
  /** 1-based competition rank (ties share a rank). */
  rank: number
  score: number
  /** Display name of a signed-in player; '' for an anonymous one. */
  name: string
  /** True for the viewer's own row. */
  you: boolean
}

/**
 * Turn the board's score list into ranked rows. Ties share a rank (480, 480,
 * 420 → 1, 1, 3). `yourScores` are the viewer's own totals (at most one with
 * the one-row-per-player board); each flags ONE matching row — the one that
 * also carries `yourName` when the viewer is signed in and it is there (so a
 * stranger tied with you is not highlighted in your place), else the first
 * with that score. Pure.
 */
export function buildLeaderboardRows(
  scores: number[],
  yourScores: number[] = [],
  names: string[] = [],
  yourName = '',
): LeaderboardRow[] {
  // Stable sort: equal scores keep the server's order (earlier finisher first).
  const sorted = scores
    .map((score, i) => ({ score, name: names[i] ?? '' }))
    .sort((a, b) => b.score - a.score)
  let prevScore: number | null = null
  let prevRank = 0
  const rows: LeaderboardRow[] = sorted.map(({ score, name }, i) => {
    const rank = prevScore !== null && score === prevScore ? prevRank : i + 1
    prevScore = score
    prevRank = rank
    return { rank, score, name, you: false }
  })
  for (const mine of yourScores) {
    const free = rows.filter((r) => !r.you && r.score === mine)
    const row = (yourName && free.find((r) => r.name === yourName)) || free[0]
    if (row) row.you = true
  }
  return rows
}
