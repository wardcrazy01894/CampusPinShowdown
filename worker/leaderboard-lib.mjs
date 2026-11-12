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
/** Rounds in a day and the most one is worth (client: ROUNDS_PER_DAY,
 *  MAX_ROUND_SCORE). */
export const ROUNDS_PER_DAY = 5
export const MAX_ROUND_SCORE = 100

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
 * PLAYER'S local calendar day (the client rolls over at local midnight). Time
 * zones run UTC−12..UTC+14, so at any instant every local DATE is within one
 * day of the UTC date. A player who started before their midnight and
 * finished after submits the EARLIER day, and clocks skew — so the window is
 * [UTC today − 2, UTC today + 1]. Anything else is an attempt to seed an
 * arbitrary past/future board (the worst case, seeding tomorrow's board a few
 * hours early, is within the documented anti-cheat non-goal).
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

/**
 * Lazy retention: run pruneOldScores at most once per UTC day, from a request
 * path, using the `meta.last_prune` marker (migration 0003). This replaces
 * the Cron Trigger, which could not be registered: the account is on the
 * Workers Free plan (5 cron triggers per account, all in use). Two requests
 * racing on the day boundary may both prune — harmless (same DELETE). Returns
 * the rows removed, or null when it was not due. Throws on D1 errors; the
 * caller treats it as best-effort.
 */
export async function pruneIfDue(db, now) {
  const today = utcDateKey(now)
  const row = await db
    .prepare(`SELECT value FROM meta WHERE key = 'last_prune'`)
    .first()
  if (row?.value === today) return null
  const removed = await pruneOldScores(db, cutoffDateKey(now))
  await db
    .prepare(
      `INSERT INTO meta (key, value, updated_at) VALUES ('last_prune', ?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(today, now.getTime())
    .run()
  return removed
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
 * The per-round detail behind a score: `[[lat, lng, score, hinted], …]`, one
 * entry per round — the guess pin, the round's points, and 1 when the region
 * hint was used. It is what lets an account's OTHER device show the finished
 * day (src/lib/sync.ts). Optional (clients from before accounts send none →
 * `null`); when present it must be well-formed and add up to `score`.
 * Returns the normalised JSON text to store.
 */
export function validateRounds(raw, score) {
  if (raw == null) return { ok: true, value: null }
  const bad = { ok: false, status: 400, error: 'invalid rounds' }
  if (!Array.isArray(raw) || raw.length !== ROUNDS_PER_DAY) return bad
  const out = []
  let sum = 0
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 3 || r.length > 4) return bad
    const [lat, lng, pts, hinted = 0] = r
    if (typeof lat !== 'number' || !(lat >= -90 && lat <= 90)) return bad
    if (typeof lng !== 'number' || !(lng >= -180 && lng <= 180)) return bad
    if (!Number.isInteger(pts) || pts < 0 || pts > MAX_ROUND_SCORE) return bad
    if (hinted !== 0 && hinted !== 1) return bad
    // ~1 m is plenty for a pin on a map of the USA.
    out.push([+lat.toFixed(5), +lng.toFixed(5), pts, hinted])
    sum += pts
  }
  if (sum !== score) return bad
  return { ok: true, value: JSON.stringify(out) }
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

  const rounds = validateRounds(body?.rounds, score)
  if (!rounds.ok) return rounds

  return {
    ok: true,
    value: { board, date, score, clientId, lineup, rounds: rounds.value },
  }
}

// ---- Queries ----------------------------------------------------------------

/**
 * UPSERT the player's score for (board, date, client_id, lineup) and read back
 * the standing in one atomic D1 batch. `clientId` is the PLAYER KEY: an
 * anonymous device id, or `acct:<id>` for a signed-in player
 * (accounts-lib.mjs: accountKey) — so an account on several devices is one
 * competitor. Keep-max per lineup (a reload of the same completion can't
 * lower or duplicate it); a changed-lineup replay gets its own row. `rounds`
 * always describes the stored score: it is replaced when the score rises,
 * and filled in when an equal score arrives for a row that had none. The
 * STANDING counts one human once: rank and `total` are over each player's
 * BEST score for the day. Ties share a rank (strictly-greater counting),
 * rank = better + 1.
 */
export async function upsertAndRank(
  db,
  { board, date, clientId, score, lineup = '', rounds = null },
  now,
) {
  const upsert = db
    .prepare(
      `INSERT INTO scores (board, date, client_id, lineup, score, rounds, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?7, ?6, ?6)
       ON CONFLICT(board, date, client_id, lineup) DO UPDATE SET
         rounds = CASE
           WHEN excluded.score > score THEN excluded.rounds
           WHEN rounds IS NULL AND excluded.score = score THEN excluded.rounds
           ELSE rounds END,
         score = MAX(score, excluded.score),
         updated_at = excluded.updated_at`,
    )
    .bind(board, date, clientId, lineup, score, now, rounds)
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
 * One row per PLAYER (their best). `names` runs parallel to `scores`: the
 * display name of a signed-in player, '' for an anonymous device. Never ids,
 * usernames or tokens. (`scores` keeps its shape so a page cached from before
 * accounts still reads the board.)
 */
export async function topScores(db, board, date, limit = TOP_LIMIT) {
  const list = db
    .prepare(
      `SELECT MAX(s.score) AS score, COALESCE(a.name, '') AS name
       FROM scores s LEFT JOIN accounts a ON s.client_id = 'acct:' || a.id
       WHERE s.board = ?1 AND s.date = ?2
       GROUP BY s.client_id
       ORDER BY score DESC, MIN(s.created_at), s.client_id LIMIT ?3`,
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
    names: listRes.results.map((r) =>
      typeof r.name === 'string' ? r.name : '',
    ),
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
  // An OLDER day than the last one counted (clock skew / a late finisher
  // inside the accepted window) must never rewind the streak: keep it as is.
  if (prev && dateKey < prev.last_played_date)
    return {
      current: prev.current,
      best: prev.best,
      last_played_date: prev.last_played_date,
    }
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
