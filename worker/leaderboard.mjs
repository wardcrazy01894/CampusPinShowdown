/**
 * Cloudflare Worker: daily leaderboard + optional accounts for CampusPin
 * Showdown (ported from KnowYourCity's kyc-leaderboard; one nationwide board;
 * accounts ported from WhereHePlay).
 *
 * Stores one keep-max score per (board, date, player, lineup) in D1 and
 * answers "you placed Xth of Y today". A player is an anonymous device UUID
 * or, when signed in, an account (username + password + display name — no
 * email, no other PII). Pure helpers live in leaderboard-lib.mjs and
 * accounts-lib.mjs so this entry exports only `default` (the Workers runtime
 * rejects non-function named exports on the entry module).
 *
 * Routes (the LAST path segment decides, so a route prefix is fine):
 *   GET  ?board=&date=                        → { total, scores[], names[] }
 *   POST (any other path) { board, date, score, clientId, lineup, rounds?,
 *                           token? }          → { rank, total, streak? }
 *   POST /register { username, pass, name?, clientId? } → { token, username, name }
 *   POST /login    { username, pass, clientId? }        → { token, username, name }
 *   POST /logout   { token }                            → {}
 *   POST /me       { token, streak? }  → { username, name, streak, days[] }
 *   POST /name     { token, name }                      → { username, name }
 *   POST /password { token, pass, newPass }             → { username, name }
 * A token never travels in a URL.
 *
 * SECURITY: a public, unauthenticated endpoint whose abuse surface is
 * *leaderboard inflation*. Mitigations: fail CLOSED unless a rate limiter OR
 * Turnstile is configured; per-IP rate limit; server-side Origin allowlist;
 * the date must be near the server's UTC today; the board must be known; the
 * score must be an integer in [0, MAX_TOTAL]. Anti-cheat is a documented
 * non-goal (scores are client-computed) — see docs/PLAN.md §Leaderboard.
 *
 * Bindings / vars (worker/wrangler.toml):
 *   DB               (D1) scores + streaks
 *   ALLOWED_ORIGIN   comma-separated origin allowlist; "*" disables (dev only)
 *   RATE_LIMITER     (native rate-limit binding) per-IP limiter
 *   LOGIN_LIMITER    (native rate-limit binding) the tight limiter on
 *                    /register (per IP) and /login (per IP + username);
 *                    those two routes fail closed without it
 *   RL               (optional KV namespace) per-IP limiter fallback
 *   TURNSTILE_SECRET (optional secret) when set, a valid token is required
 */

import {
  cors,
  originAllowed,
  validateSubmission,
  upsertAndRank,
  validateView,
  topScores,
  cutoffDateKey,
  pruneOldScores,
  pruneIfDue,
  updateStreak,
  BOARDS,
} from './leaderboard-lib.mjs'
import {
  accountKey,
  accountForToken,
  isValidPass,
  validateName,
  validateUsername,
  validateStreakClaim,
  createAccount,
  verifyLogin,
  openSession,
  closeSession,
  renameAccount,
  setPassword,
  closeOtherSessions,
  foldIntoAccount,
  readProgress,
} from './accounts-lib.mjs'

const MAX_BODY_BYTES = 4_000
// KV-fallback rate limit, kept in step with the native [[ratelimits]] binding.
const RL_MAX = 30
const RL_WINDOW_SECONDS = 60

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

const ACCOUNT_ROUTES = new Set([
  'register',
  'login',
  'logout',
  'me',
  'name',
  'password',
])
const DEFAULT_BOARD = 'usa'

/**
 * The account routes. Returns `[body, status]`. Throws on a D1 error (the
 * caller answers 503).
 */
async function accountRoute(route, body, env, ip, now) {
  const db = env.DB
  const board = BOARDS.has(body.board) ? body.board : DEFAULT_BOARD
  const signedIn = (account, token) => ({
    ok: true,
    ...(token ? { token } : {}),
    username: account.username,
    name: account.name,
  })

  if (route === 'register' || route === 'login') {
    const u = validateUsername(body.username)
    const passOk = isValidPass(body.pass)
    if (route === 'login' && (!u.ok || !passOk))
      return [{ error: 'wrong username or password' }, 401]
    if (!u.ok) return [{ error: u.error }, u.status]
    if (!passOk) return [{ error: 'invalid password' }, 400]
    let name = ''
    if (route === 'register' && body.name != null && body.name !== '') {
      const n = validateName(body.name)
      if (!n.ok) return [{ error: n.error }, n.status]
      name = n.value
    }
    // Password guessing is the one attack here with a real payoff, and every
    // registration is a row someone has to look at: both sit behind a much
    // tighter limiter than the rest, and fail closed without it.
    if (!env.LOGIN_LIMITER) return [{ error: 'accounts disabled' }, 503]
    const gate = await env.LOGIN_LIMITER.limit({
      key: route === 'login' ? `${ip}|${u.value}` : `${ip}|register`,
    })
    if (!gate.success)
      return [{ error: 'too many attempts, try again in a minute' }, 429]

    const r =
      route === 'register'
        ? await createAccount(
            db,
            { username: u.value, name, pass: body.pass },
            now.getTime(),
          )
        : await verifyLogin(db, u.value, body.pass)
    if (!r.ok) return [{ error: r.error }, r.status]
    // What this device did before signing in becomes the account's. Best
    // effort: a failure here must not leave a freshly created account
    // without a session (a retry would then say "username taken"), and the
    // fold is idempotent — the next sign-in from this device redoes it.
    try {
      await foldIntoAccount(
        db,
        board,
        r.value.id,
        { clientId: body.clientId },
        now.getTime(),
      )
    } catch (e) {
      console.warn('leaderboard account fold failed', {
        route,
        error: String(e),
      })
    }
    const token = await openSession(db, r.value.id, now.getTime())
    return [signedIn(r.value, token), 200]
  }

  if (route === 'logout') {
    await closeSession(db, body.token)
    return [{ ok: true }, 200]
  }

  const account = await accountForToken(db, body.token)
  // 401 = "this device is no longer signed in" (signed out, or its session
  // pushed out by the account's ten newest); the client drops the token and
  // carries on anonymously. Sessions do not otherwise expire: with no
  // password reset, an expiry would lock out anyone who forgot theirs.
  if (!account) return [{ error: 'signed out' }, 401]

  if (route === 'name') {
    const n = validateName(body.name)
    if (!n.ok) return [{ error: n.error }, n.status]
    await renameAccount(db, account.id, n.value)
    return [signedIn({ ...account, name: n.value }), 200]
  }

  if (route === 'password') {
    // Change the password from a signed-in device. The CURRENT password is
    // still required (a borrowed, unlocked phone must not be enough to take
    // the account), behind the same tight limiter as login.
    if (!isValidPass(body.newPass)) return [{ error: 'invalid password' }, 400]
    if (!env.LOGIN_LIMITER) return [{ error: 'accounts disabled' }, 503]
    const gate = await env.LOGIN_LIMITER.limit({
      key: `${ip}|${account.username}`,
    })
    if (!gate.success)
      return [{ error: 'too many attempts, try again in a minute' }, 429]
    const current = isValidPass(body.pass)
      ? await verifyLogin(db, account.username, body.pass)
      : { ok: false }
    if (!current.ok) return [{ error: 'wrong password' }, 401]
    await setPassword(db, account.id, body.newPass)
    // Whoever else was signed in with the old password is signed out.
    await closeOtherSessions(db, account.id, body.token)
    return [signedIn(account), 200]
  }

  // route === 'me': fold the device's local streak in, then say what the
  // account has (src/lib/sync.ts applies it).
  const claim = validateStreakClaim(body.streak, now)
  if (claim)
    await foldIntoAccount(db, board, account.id, { claim }, now.getTime())
  const progress = await readProgress(db, board, account.id, now)
  return [{ ...signedIn(account), ...progress }, 200]
}

async function verifyTurnstile(token, secret, ip) {
  if (!token) return false
  const form = new URLSearchParams({ secret, response: token })
  if (ip) form.set('remoteip', ip)
  try {
    const r = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form },
    )
    const data = await r.json()
    return Boolean(data.success)
  } catch (e) {
    // A siteverify network failure looks identical to a bot rejection (both
    // 403). Log it distinctly so an outage is diagnosable.
    console.warn('leaderboard turnstile siteverify network error', {
      error: String(e),
    })
    return false
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin')
    const headers = cors(env, origin)
    if (request.method === 'OPTIONS') return new Response(null, { headers })
    if (request.method !== 'POST' && request.method !== 'GET')
      return json({ error: 'method not allowed' }, 405, headers)

    // Fail CLOSED: refuse to operate without at least one anti-abuse control.
    if (!env.RATE_LIMITER && !env.RL && !env.TURNSTILE_SECRET)
      return json(
        { error: 'leaderboard disabled: configure a rate limit or Turnstile' },
        503,
        headers,
      )

    // Server-side Origin allowlist (CORS headers alone don't stop curl).
    if (origin && !originAllowed(env, origin))
      return json({ error: 'forbidden origin' }, 403, headers)

    if (!env.DB) return json({ error: 'leaderboard unavailable' }, 503, headers)

    const len = parseInt(request.headers.get('Content-Length') || '0', 10)
    if (len > MAX_BODY_BYTES)
      return json({ error: 'payload too large' }, 413, headers)

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'

    // Per-IP rate limit (native binding preferred, KV counter fallback).
    if (env.RATE_LIMITER) {
      const { success } = await env.RATE_LIMITER.limit({ key: ip })
      if (!success)
        return json({ error: 'rate limited, try later' }, 429, headers)
    } else if (env.RL) {
      const key = `rl:${ip}`
      const n = parseInt((await env.RL.get(key)) || '0', 10)
      if (n >= RL_MAX)
        return json({ error: 'rate limited, try later' }, 429, headers)
      await env.RL.put(key, String(n + 1), { expirationTtl: RL_WINDOW_SECONDS })
    }

    // GET — view the day's board (read-only, anonymous: scores only).
    if (request.method === 'GET') {
      const q = new URL(request.url).searchParams
      const vv = validateView({ board: q.get('board'), date: q.get('date') })
      if (!vv.ok) return json({ error: vv.error }, vv.status, headers)
      try {
        const board = await topScores(env.DB, vv.value.board, vv.value.date)
        return json({ ok: true, ...board }, 200, headers)
      } catch (e) {
        console.error('leaderboard read failed', {
          board: vv.value.board,
          date: vv.value.date,
          error: String(e),
        })
        return json({ error: 'leaderboard unavailable' }, 503, headers)
      }
    }

    let body
    try {
      const raw = await request.text()
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES)
        return json({ error: 'payload too large' }, 413, headers)
      body = JSON.parse(raw)
    } catch {
      return json({ error: 'invalid json' }, 400, headers)
    }

    // Bot check (only when Turnstile is configured for this worker).
    if (env.TURNSTILE_SECRET) {
      const ok = await verifyTurnstile(
        body?.turnstileToken,
        env.TURNSTILE_SECRET,
        ip,
      )
      if (!ok) return json({ error: 'verification failed' }, 403, headers)
    }

    const route = new URL(request.url).pathname
      .replace(/\/+$/, '')
      .split('/')
      .pop()
    if (ACCOUNT_ROUTES.has(route)) {
      if (!body || typeof body !== 'object')
        return json({ error: 'invalid json' }, 400, headers)
      try {
        const [out, status] = await accountRoute(
          route,
          body,
          env,
          ip,
          new Date(),
        )
        return json(out, status, headers)
      } catch (e) {
        console.error('leaderboard account request failed', {
          route,
          error: String(e),
        })
        return json({ error: 'accounts unavailable' }, 503, headers)
      }
    }

    const v = validateSubmission(body, new Date())
    if (!v.ok) return json({ error: v.error }, v.status, headers)

    try {
      const now = Date.now()
      // Signed in → the score is the ACCOUNT's (one row across its devices).
      // A token that no longer resolves is not an error: the day still counts
      // for the anonymous device, and the next sign-in folds it in.
      const account = body?.token
        ? await accountForToken(env.DB, body.token)
        : null
      if (account) v.value.clientId = accountKey(account.id)
      const standing = await upsertAndRank(env.DB, v.value, now)
      // Advance the per-player streak. Best-effort: a streak failure must not
      // fail the score submission, so it's caught independently.
      let streak
      try {
        streak = await updateStreak(env.DB, v.value, now)
      } catch (e) {
        // A PERSISTENT streak failure (e.g. a missing migration) would
        // silently strip everyone's streak — make it visible.
        console.warn('leaderboard streak update failed', {
          board: v.value.board,
          error: String(e),
        })
        streak = undefined
      }
      // Lazy retention prune (at most once per UTC day; see pruneIfDue). Runs
      // after the response is built and never affects it.
      ctx?.waitUntil?.(
        pruneIfDue(env.DB, new Date()).catch((e) =>
          console.error('leaderboard lazy prune failed', { error: String(e) }),
        ),
      )
      return json({ ok: true, ...standing, streak }, 200, headers)
    } catch (e) {
      // D1 outage / quota — degrade gracefully; the client just omits the
      // standing line. Never 500 on the player; log it so it's diagnosable.
      console.error('leaderboard submit failed', {
        board: v.value.board,
        error: String(e),
      })
      return json({ error: 'leaderboard unavailable' }, 503, headers)
    }
  },

  /**
   * Cron Trigger handler, kept for the day a cron slot is available (the
   * account's Workers Free plan allows 5 per account and they are all taken,
   * so [triggers] is NOT in wrangler.toml today). Retention is covered by the
   * lazy prune in `fetch` (pruneIfDue). Best effort either way.
   */
  async scheduled(_event, env, ctx) {
    if (!env.DB) return
    ctx.waitUntil(
      pruneOldScores(env.DB, cutoffDateKey(new Date())).catch((e) =>
        console.error('leaderboard prune failed', { error: String(e) }),
      ),
    )
  },
}
