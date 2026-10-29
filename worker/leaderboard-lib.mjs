/**
 * Pure helpers + constants for the leaderboard Worker (ported from
 * KnowYourCity, one nationwide board instead of per-city boards).
 *
 * These live in a SEPARATE module (not the Worker entry) on purpose: the Workers
 * runtime enumerates the *entry* module's named exports and rejects any that
 * aren't a function/ExportedHandler — so a `export const MAX_TOTAL = 500` in the
 * entry crashes the worker at boot. Keeping constants + validation here lets the
 * entry (leaderboard.mjs) export only `default`, and keeps everything unit
 * testable without a Worker or a database.
 */

/** Perfect day = 5 rounds × 100. Kept in step with the client's
 *  ROUNDS_PER_DAY × MAX_ROUND_SCORE (src/lib/daily.ts, src/lib/scoring.ts). */
export const MAX_TOTAL = 500

/** The boards that exist. One nationwide board today; the column is in the
 *  primary key so a second region later is independent by construction. */
export const BOARDS = new Set(['usa'])

// ---- Origin allowlist / CORS (shared semantics with KnowYourCity's workers) --

/** ALLOWED_ORIGIN may be "*" or a comma-separated list of origins. */
export function allowedOrigins(env) {
  return (env.ALLOWED_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function originAllowed(env, origin) {
  const list = allowedOrigins(env)
  return list.includes('*') || (origin && list.includes(origin))
}

export function cors(env, origin) {
  const list = allowedOrigins(env)
  // Reflect the request origin when it's allowed (can't use "*" + a specific
  // list); fall back to the first configured origin.
  const allow = list.includes('*')
    ? '*'
    : origin && list.includes(origin)
      ? origin
      : list[0] || '*'
  return {
    'Access-Control-Allow-Origin': allow,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

// ---- Dates ------------------------------------------------------------------

/** UTC calendar day ("YYYY-MM-DD") for `now`. */
export function utcDateKey(now) {
  return now.toISOString().slice(0, 10)
}

/**
 * The puzzle days we accept a submission for at `now`. The puzzle day is the
 * PLAYER'S local calendar day (the client rolls over at local midnight), and
 * at any instant the world's local dates span UTC-1 .. UTC+1. A player who
 * started before their midnight and finished after submits the EARLIER day,
 * and clocks skew — so the window is [UTC today − 2, UTC today + 1]. Anything
 * else is an attempt to seed an arbitrary past/future board.
 */
export function validDateKeys(now) {
  const DAY = 86_400_000
  return new Set(
    [-2, -1, 0, 1].map((d) => utcDateKey(new Date(now.getTime() + d * DAY))),
  )
}

/** True if `key` is a REAL calendar date in YYYY-MM-DD form (mirrors the
 *  client's isValidDateKey — rejects 2026-99-99 etc. via a UTC round-trip). */
export function isValidDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const d = new Date(key + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key
}

/** The calendar day before `dateKey` ("YYYY-MM-DD"), via a UTC round-trip.
 *  Mirrors the client's previousDateKey (src/lib/progress.ts). */
export function previousDateKey(dateKey) {
  const d = new Date(dateKey + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ---- Field validation -------------------------------------------------------

/** True for a real integer total in [0, MAX_TOTAL]. Rejects NaN/floats/strings. */
export function isValidScore(score) {
  return Number.isInteger(score) && score >= 0 && score <= MAX_TOTAL
}

/** Anonymous device id shape: UUID-ish, kept short and charset-safe. */
export function isValidClientId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id)
}

/**
 * Lineup hash shape (client progress.ts:lineupHash — base36 of an unsigned
 * 32-bit hash, so never a leading '-'). Identifies WHICH official set a
 * completion was for. Empty string = a client that sent none.
 */
export function isValidLineup(v) {
  return typeof v === 'string' && /^[0-9a-z]{0,16}$/.test(v)
}

/**
 * Validate a leaderboard VIEW query (read-only). Any real date is allowed
 * (read-only, capped), but the board must be known. Pure.
 */
export function validateView(query) {
  const board = String(query?.board ?? '')
  if (!BOARDS.has(board))
    return { ok: false, status: 400, error: 'unknown board' }
  const date = String(query?.date ?? '')
  if (!isValidDateKey(date))
    return { ok: false, status: 400, error: 'invalid date' }
  return { ok: true, value: { board, date } }
}

/**
 * Validate + normalize a submission against the server's clock. Returns
 * `{ ok: true, value }` or `{ ok: false, status, error }`. Pure given `now`.
 */
export function validateSubmission(body, now = new Date()) {
  const board = String(body?.board ?? '')
  if (!BOARDS.has(board))
    return { ok: false, status: 400, error: 'unknown board' }

  const date = String(body?.date ?? '')
  if (!isValidDateKey(date) || !validDateKeys(now).has(date))
    return { ok: false, status: 400, error: 'date out of range' }

  const score = body?.score
  if (!isValidScore(score))
    return { ok: false, status: 400, error: 'invalid score' }

  const clientId = body?.clientId
  if (!isValidClientId(clientId))
    return { ok: false, status: 400, error: 'invalid clientId' }

  const lineup = body?.lineup == null ? '' : String(body.lineup)
  if (!isValidLineup(lineup))
    return { ok: false, status: 400, error: 'invalid lineup' }

  return { ok: true, value: { board, date, score, clientId, lineup } }
}

// ---- Queries ----------------------------------------------------------------

/**
 * UPSERT the device's score for (board, date, client_id, lineup) and read back
 * the standing in one atomic D1 batch. Keep-max per lineup (a reload of the
 * same completion can't lower or duplicate it); a changed-lineup replay gets
 * its own row. The STANDING counts one human once: rank and `total` are over
 * each device's BEST score for the day. Ties share a rank (strictly-greater
 * counting), rank = better + 1.
 */
export async function upsertAndRank(
  db,
  { board, date, clientId, score, lineup = '' },
  now,
) {
  const upsert = db
    .prepare(
      `INSERT INTO scores (board, date, client_id, lineup, score, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
       ON CONFLICT(board, date, client_id, lineup) DO UPDATE SET
         score = MAX(score, excluded.score),
         updated_at = excluded.updated_at`,
    )
    .bind(board, date, clientId, lineup, score, now)
  const standing = db
    .prepare(
      `WITH best AS (
         SELECT client_id, MAX(score) AS score FROM scores
         WHERE board = ?1 AND date = ?2
         GROUP BY client_id
       )
       SELECT
         (SELECT COUNT(*) FROM best
            WHERE score > (SELECT score FROM best WHERE client_id = ?3)
         ) AS better,
         (SELECT COUNT(*) FROM best) AS total`,
    )
    .bind(board, date, clientId)
  const results = await db.batch([upsert, standing])
  const row = results[1].results[0]
  return { rank: Number(row.better) + 1, total: Number(row.total) }
}

/** Max rows the view endpoint returns — caps the read so a busy day stays
 *  cheap and the anonymous list can't be scraped wholesale. */
export const TOP_LIMIT = 100

/**
 * The day's top scores (desc, capped at TOP_LIMIT) plus the total entry count.
 * Anonymous: scores only — no ids, no names. One row per DEVICE (its best).
 */
export async function topScores(db, board, date, limit = TOP_LIMIT) {
  const list = db
    .prepare(
      `SELECT MAX(score) AS score FROM scores
       WHERE board = ?1 AND date = ?2
       GROUP BY client_id
       ORDER BY score DESC LIMIT ?3`,
    )
    .bind(board, date, limit)
  const count = db
    .prepare(
      `SELECT COUNT(DISTINCT client_id) AS total FROM scores
       WHERE board = ?1 AND date = ?2`,
    )
    .bind(board, date)
  const [listRes, countRes] = await db.batch([list, count])
  return {
    total: Number(countRes.results[0].total) || 0,
    scores: listRes.results.map((r) => Number(r.score)),
  }
}

/** How long a day's scores are kept. Streaks live in their own table and are
 *  never pruned. */
export const RETENTION_DAYS = 90

/** The oldest date key to KEEP — anything strictly before this is pruned. */
export function cutoffDateKey(now, days = RETENTION_DAYS) {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

/** Delete daily scores older than `cutoff` (YYYY-MM-DD). Returns rows removed. */
export async function pruneOldScores(db, cutoff) {
  const res = await db
    .prepare(`DELETE FROM scores WHERE date < ?1`)
    .bind(cutoff)
    .run()
  return res?.meta?.changes ?? 0
}

/**
 * Advance a per-player streak for playing `dateKey`. Mirrors the client's
 * bumpStreak: same-day replay keeps the count, the immediately previous day
 * increments, any other gap resets to 1; `best` is the running max. Pure —
 * `prev` is the stored row (or null for a first-ever play).
 */
export function advanceStreak(prev, dateKey) {
  let current
  if (!prev) current = 1
  else if (prev.last_played_date === dateKey) current = prev.current
  else if (prev.last_played_date === previousDateKey(dateKey))
    current = prev.current + 1
  else current = 1
  return {
    current,
    best: Math.max(prev?.best ?? 0, current),
    last_played_date: dateKey,
  }
}

/**
 * Read → advance → upsert the player's streak for (board, client_id). Returns
 * `{ current, best }`. Separate from the score write so a streak hiccup never
 * blocks the score.
 */
export async function updateStreak(db, { board, clientId, date }, now) {
  const prev = await db
    .prepare(
      `SELECT current, best, last_played_date FROM streaks
       WHERE board = ?1 AND client_id = ?2`,
    )
    .bind(board, clientId)
    .first()
  const next = advanceStreak(prev, date)
  await db
    .prepare(
      `INSERT INTO streaks (board, client_id, current, best, last_played_date, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(board, client_id) DO UPDATE SET
         current = excluded.current,
         best = excluded.best,
         last_played_date = excluded.last_played_date,
         updated_at = excluded.updated_at`,
    )
    .bind(board, clientId, next.current, next.best, next.last_played_date, now)
    .run()
  return { current: next.current, best: next.best }
}
