/**
 * Cloudflare Worker: anonymous daily leaderboard for CampusPin Showdown
 * (ported from KnowYourCity's kyc-leaderboard; one nationwide board).
 *
 * Stores one keep-max score per (board, date, device, lineup) in D1 and
 * answers "you placed Xth of Y today". No accounts, no names, no PII — just an
 * anonymous device UUID. Pure helpers live in leaderboard-lib.mjs so this entry
 * exports only `default` (the Workers runtime rejects non-function named
 * exports on the entry module).
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
  updateStreak,
} from './leaderboard-lib.mjs'

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
  async fetch(request, env) {
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

    const v = validateSubmission(body, new Date())
    if (!v.ok) return json({ error: v.error }, v.status, headers)

    try {
      const now = Date.now()
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
   * Cron Trigger ([triggers] in wrangler.toml): prune daily scores older than
   * RETENTION_DAYS so the table stays bounded. Best effort — a failure just
   * retries next run; it never affects the live game.
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
