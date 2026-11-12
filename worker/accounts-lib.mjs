/**
 * Optional accounts for the leaderboard Worker: a username, a password and a
 * display name (no email). Validation, password hashing, sessions, and the
 * fold that lets an account INHERIT what its devices already have. Ported
 * from WhereHePlay's api-lib.mjs, reshaped for this worker's device-keyed
 * tables.
 *
 * How an account sits in the existing schema: its scores and streak are
 * ordinary `scores` / `streaks` rows whose `client_id` is the player key
 * `acct:<id>` (accountKey). A browser-minted device id cannot contain ':'
 * (isValidClientId), so the key cannot be forged, and rank / total / board /
 * keep-max / streak all treat a signed-in player on three devices as ONE
 * competitor with no change to those queries.
 *
 * Kept out of the entry module for the same reason as leaderboard-lib.mjs
 * (the Workers runtime rejects non-handler exports on the entry).
 *
 * Trust model (docs/PLAN.md §Accounts): scores and streaks are computed in
 * the browser, so anti-cheat stays a non-goal. The controls here stop
 * accidents, drive-by abuse and account takeover.
 */

import {
  isValidClientId,
  isValidDateKey,
  previousDateKey,
  validDateKeys,
} from './leaderboard-lib.mjs'

export const MAX_SESSIONS_PER_ACCOUNT = 10
/** Server half of the split KDF — small because Workers Free allows ~10 ms CPU. */
export const SERVER_KDF_ITERATIONS = 1000
/** Puzzle #1 (src/lib/daily.ts: EPOCH_DATE_KEY). No streak can predate it. */
export const EPOCH_DATE_KEY = '2026-10-29'

const fail = (status, error) => ({ ok: false, status, error })

/** The `client_id` under which an account's scores and streak are stored. */
export function accountKey(id) {
  return `acct:${id}`
}

// ---- Validation ---------------------------------------------------------------

/** A session token: 48 hex chars (24 random bytes). */
export function isValidToken(t) {
  return typeof t === 'string' && /^[0-9a-f]{48}$/.test(t)
}

/** The client-derived password key: 64 hex chars (PBKDF2-SHA256 output). */
export function isValidPass(p) {
  return typeof p === 'string' && /^[0-9a-f]{64}$/.test(p)
}

/**
 * Words a display name or username may not contain (matched on the letters
 * only, so "f.u.c.k" and "FUCK" are caught). Deliberately short, and free of
 * fragments that sit inside real names (Hancock, Dickinson, "Spicy"): it
 * stops the obvious, it is not a moderation system (an admin can rename by
 * hand — docs/OPERATIONS.md).
 */
const BLOCKED = [
  'fuck',
  'shit',
  'cunt',
  'nigg',
  'faggot',
  'bitch',
  'whore',
  'slut',
  'rapist',
  'nazi',
  'hitler',
  'kike',
  'porn',
  'pussy',
]
/** Digits and symbols commonly swapped in for letters. */
const LEET = {
  0: 'o',
  1: 'i',
  3: 'e',
  4: 'a',
  5: 's',
  7: 't',
  '@': 'a',
  $: 's',
  '!': 'i',
}

export function isClean(text) {
  // Fold compatibility forms and accents, undo leetspeak, then match on the
  // bare letters. Names are Latin-script only (validateName), so lookalike
  // letters from other scripts never get here.
  const letters = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[0134578@$!]/g, (c) => LEET[c])
    .replace(/[^a-z]/g, '')
  return !BLOCKED.some((w) => letters.includes(w))
}

/**
 * Display name: 2–20 chars of Latin letters (accents allowed), digits, space
 * and _ . - '. NFKC first, so fullwidth forms become plain characters;
 * Latin-only, so a Cyrillic or Greek lookalike cannot impersonate another
 * player or slip a blocked word past the filter. The charset also keeps
 * markup out of the leaderboard.
 */
export function validateName(raw) {
  if (typeof raw !== 'string') return fail(400, 'invalid name')
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (name.length < 2 || name.length > 20)
    return fail(400, 'name must be 2 to 20 characters')
  if (!/^[\p{Script=Latin}0-9 _.'-]+$/u.test(name))
    return fail(400, "name can use letters, numbers, spaces and _ . - '")
  if (!isClean(name)) return fail(400, 'pick a different name')
  return { ok: true, value: name }
}

/** Username: 3–20 of a-z 0-9 _ (stored lowercased). Never an email. */
export function validateUsername(raw) {
  if (typeof raw !== 'string') return fail(400, 'invalid username')
  const username = raw.trim().toLowerCase()
  if (username.includes('@'))
    return fail(
      400,
      'a username is not an email: use 3 to 20 letters, numbers or _',
    )
  if (!/^[a-z0-9_]{3,20}$/.test(username))
    return fail(400, 'username must be 3 to 20 letters, numbers or _')
  if (!isClean(username)) return fail(400, 'pick a different username')
  return { ok: true, value: username }
}

const isCount = (n) => Number.isInteger(n) && n >= 1

/**
 * A device vouching for the streak in its localStorage, so an account
 * created today inherits a streak built before accounts existed (the server's
 * own table missed every day a submit failed, and all of them before the
 * leaderboard was switched on). Unverifiable, like the scores themselves —
 * so it is only bounded: a real day no later than the submission window, no
 * earlier than puzzle #1, and no longer than the game has existed. Returns
 * the streak row, or null for anything else (the claim is then ignored).
 */
export function validateStreakClaim(raw, now) {
  if (!raw || typeof raw !== 'object') return null
  const { current, best, last } = raw
  if (!isCount(current) || !isCount(best) || best < current) return null
  if (typeof last !== 'string' || !isValidDateKey(last)) return null
  const latest = [...validDateKeys(now)].sort().pop()
  if (last < EPOCH_DATE_KEY || last > latest) return null
  const DAY = 86_400_000
  const possible =
    Math.round((Date.parse(last) - Date.parse(EPOCH_DATE_KEY)) / DAY) + 1
  if (best > possible) return null
  return { current, best, last_played_date: last }
}

// ---- Crypto -------------------------------------------------------------------

const hex = (buf) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  )

export async function sha256Hex(text) {
  return hex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  )
}

export function randomHex(bytes) {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return hex(b)
}

/**
 * Passwords use a SPLIT KDF: the browser stretches the password (PBKDF2,
 * 150k iterations, salted with the username — src/lib/account.ts) and sends
 * only that derived key; the server stretches it again with a random
 * per-account salt before storing. The plaintext password never leaves the
 * device, the expensive part runs on the client (Workers Free = ~10 ms CPU),
 * and the stored hash is not replayable as a login.
 */
export async function hashPass(pass, saltHex) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(pass),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: enc.encode(saltHex),
      iterations: SERVER_KDF_ITERATIONS,
    },
    key,
    256,
  )
  return hex(bits)
}

/** Constant-time comparison of two equal-length hex strings. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length)
    return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ---- Accounts + sessions ------------------------------------------------------

/**
 * Create an account. 409 when the username is taken (the UNIQUE constraint
 * decides a race). An empty display name defaults to the username.
 */
export async function createAccount(db, { username, name, pass }, now) {
  const taken = await db
    .prepare(`SELECT 1 AS x FROM accounts WHERE username = ?1`)
    .bind(username)
    .first()
  if (taken) return fail(409, 'that username is taken')
  const salt = randomHex(16)
  const hash = await hashPass(pass, salt)
  const shown = name || username
  let row
  try {
    row = await db
      .prepare(
        `INSERT INTO accounts (username, name, pass_salt, pass_hash, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`,
      )
      .bind(username, shown, salt, hash, now)
      .first()
  } catch {
    return fail(409, 'that username is taken')
  }
  return { ok: true, value: { id: row.id, username, name: shown } }
}

/** A salt to burn equal work on when the username does not exist. */
const DUMMY_SALT = '00000000000000000000000000000000'

/**
 * Check a username + password key. The same error and the same amount of
 * hashing whether the username exists or not.
 */
export async function verifyLogin(db, username, pass) {
  const row = await db
    .prepare(
      `SELECT id, username, name, pass_salt, pass_hash FROM accounts WHERE username = ?1`,
    )
    .bind(username)
    .first()
  const hash = await hashPass(pass, row?.pass_salt ?? DUMMY_SALT)
  if (!row || !safeEqual(hash, row.pass_hash))
    return fail(401, 'wrong username or password')
  return {
    ok: true,
    value: { id: row.id, username: row.username, name: row.name },
  }
}

/** Mint a session token for one device; keeps only the newest few. */
export async function openSession(db, accountId, now) {
  const token = randomHex(24)
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, account_id, created_at) VALUES (?1, ?2, ?3)`,
    )
    .bind(await sha256Hex(token), accountId, now)
    .run()
  await db
    .prepare(
      `DELETE FROM sessions WHERE account_id = ?1 AND token_hash NOT IN (
         SELECT token_hash FROM sessions WHERE account_id = ?1
         ORDER BY created_at DESC, token_hash LIMIT ?2)`,
    )
    .bind(accountId, MAX_SESSIONS_PER_ACCOUNT)
    .run()
  return token
}

export async function closeSession(db, token) {
  if (!isValidToken(token)) return
  await db
    .prepare(`DELETE FROM sessions WHERE token_hash = ?1`)
    .bind(await sha256Hex(token))
    .run()
}

/** The account behind a session token, or null. */
export async function accountForToken(db, token) {
  if (!isValidToken(token)) return null
  const row = await db
    .prepare(
      `SELECT a.id, a.username, a.name FROM sessions s
       JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?1`,
    )
    .bind(await sha256Hex(token))
    .first()
  return row ?? null
}

/** Replace an account's password (a fresh salt each time). */
export async function setPassword(db, accountId, pass) {
  const salt = randomHex(16)
  const hash = await hashPass(pass, salt)
  await db
    .prepare(`UPDATE accounts SET pass_salt = ?1, pass_hash = ?2 WHERE id = ?3`)
    .bind(salt, hash, accountId)
    .run()
}

/** Sign an account out everywhere except the session behind `keepToken`. */
export async function closeOtherSessions(db, accountId, keepToken) {
  await db
    .prepare(`DELETE FROM sessions WHERE account_id = ?1 AND token_hash != ?2`)
    .bind(accountId, await sha256Hex(keepToken))
    .run()
}

export async function renameAccount(db, accountId, name) {
  await db
    .prepare(`UPDATE accounts SET name = ?1 WHERE id = ?2`)
    .bind(name, accountId)
    .run()
}

// ---- Inheriting a device's progress -------------------------------------------

/**
 * Two streaks for the same player, as one. The later last-played day decides
 * the count — on the same day, the LONGER one (the owner's rule: two devices
 * with different streaks become the longer). When the two days are
 * consecutive the run is unbroken, so it is at least the earlier count + 1.
 * A streak whose last day is older than that has lapsed and does not come
 * back; `best` only ever grows.
 */
export function mergeStreaks(a, b) {
  if (!a) return b ?? null
  if (!b) return a
  const [older, newer] =
    a.last_played_date <= b.last_played_date ? [a, b] : [b, a]
  let current
  if (older.last_played_date === newer.last_played_date)
    current = Math.max(older.current, newer.current)
  else if (previousDateKey(newer.last_played_date) === older.last_played_date)
    current = Math.max(newer.current, older.current + 1)
  else current = newer.current
  return {
    current,
    best: Math.max(a.best, b.best, current),
    last_played_date: newer.last_played_date,
  }
}

const streakRow = (db, board, key) =>
  db
    .prepare(
      `SELECT current, best, last_played_date FROM streaks
       WHERE board = ?1 AND client_id = ?2`,
    )
    .bind(board, key)
    .first()

/**
 * Fold what a device already has into account `accountId`:
 *
 * - `clientId` — the device's ANONYMOUS id. Its score rows move to the
 *   account (where both have one for the same day and lineup, the better
 *   score stands, with its rounds) and its server streak is merged, then the
 *   anonymous rows are deleted — so signing in after playing leaves one row
 *   on the board, not an anonymous twin. Knowing the id is the proof of
 *   owning it (the board never shows ids). Anything that is not a device id
 *   — junk, or another account's key — is ignored: accounts never merge.
 * - `claim` — the device's local streak (validateStreakClaim), merged too.
 *
 * @param {{ clientId?: unknown, claim?: { current: number, best: number, last_played_date: string } | null }} from
 */
export async function foldIntoAccount(db, board, accountId, from, now) {
  const { clientId, claim } = from
  const key = accountKey(accountId)
  let incoming = claim ?? null
  if (isValidClientId(clientId)) {
    await db
      .prepare(
        `INSERT INTO scores (board, date, client_id, lineup, score, rounds, created_at, updated_at)
         SELECT board, date, ?2, lineup, score, rounds, created_at, updated_at
           FROM scores WHERE client_id = ?1
         ON CONFLICT(board, date, client_id, lineup) DO UPDATE SET
           rounds = CASE
             WHEN excluded.score > score THEN excluded.rounds
             WHEN rounds IS NULL AND excluded.score = score THEN excluded.rounds
             ELSE rounds END,
           score = MAX(score, excluded.score),
           updated_at = MAX(updated_at, excluded.updated_at)`,
      )
      .bind(clientId, key)
      .run()
    await db
      .prepare(`DELETE FROM scores WHERE client_id = ?1`)
      .bind(clientId)
      .run()
    incoming = mergeStreaks(incoming, await streakRow(db, board, clientId))
    await db
      .prepare(`DELETE FROM streaks WHERE client_id = ?1`)
      .bind(clientId)
      .run()
  }
  if (!incoming) return
  const next = mergeStreaks(await streakRow(db, board, key), incoming)
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
    .bind(board, key, next.current, next.best, next.last_played_date, now)
    .run()
}

function parseRounds(text) {
  if (typeof text !== 'string') return null
  try {
    const v = JSON.parse(text)
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

/**
 * What another device needs to pick up where this account left off: the
 * streak, and the results still inside the submission window (so "today",
 * whatever the device's time zone) with their per-round detail. Best score
 * first within a day. Only ever the caller's own rows.
 */
export async function readProgress(db, board, accountId, now) {
  const key = accountKey(accountId)
  const since = [...validDateKeys(now)].sort()[0]
  const streak = db
    .prepare(
      `SELECT current, best, last_played_date AS last FROM streaks
       WHERE board = ?1 AND client_id = ?2`,
    )
    .bind(board, key)
  const days = db
    .prepare(
      `SELECT date, lineup, score, rounds FROM scores
       WHERE board = ?1 AND client_id = ?2 AND date >= ?3
       ORDER BY date, score DESC, lineup`,
    )
    .bind(board, key, since)
  const [st, sc] = await db.batch([streak, days])
  const s = st.results[0]
  return {
    streak: s
      ? { current: Number(s.current), best: Number(s.best), last: s.last }
      : null,
    days: sc.results.map((r) => ({
      date: r.date,
      lineup: r.lineup,
      score: Number(r.score),
      rounds: parseRounds(r.rounds),
    })),
  }
}
