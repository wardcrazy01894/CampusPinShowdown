/**
 * Cloudflare Worker: receive a bug report from the app and file a GitHub
 * issue (port of KnowYourCity's kyl-bug; its own worker, `cps-bug`).
 *
 * Keeps the GitHub token server-side (never in the client bundle). The app
 * points VITE_BUG_ENDPOINT at this URL; without it the form falls back to a
 * prefilled GitHub "new issue" page.
 *
 * SECURITY: a public, unauthenticated endpoint. Hardening:
 *   - spam/flooding        → per-IP rate limit (fails CLOSED without one or
 *                            Turnstile) + optional Turnstile
 *   - content injection    → defang() (bug-report-lib.mjs)
 *   - phishing links       → the reported URL is kept only if it is from our
 *                            own origin, embedded parsed + defanged
 *   - XSS-pivot            → server-side Origin allowlist (not just CORS)
 *   - giant payloads       → Content-Length early reject + cap on bytes read
 *   - token blast radius   → fine-grained PAT, Issues: read & write, this repo
 *
 * Vars / secrets (worker/wrangler.bug.toml, `wrangler secret put`):
 *   GH_TOKEN          (secret) fine-grained PAT, Issues: read & write, this repo
 *   GH_REPO           "owner/repo" to file issues in
 *   ALLOWED_ORIGIN    comma-separated origin allowlist ("*" disables — dev only)
 *   TURNSTILE_SECRET  (secret, optional) Cloudflare Turnstile verification
 *   RATE_LIMITER      (native rate-limit binding) per-IP limiter
 *   RL                (optional KV namespace) per-IP limiter fallback
 */

import { allowedOrigins, cors, originAllowed } from './leaderboard-lib.mjs'
import { defang, urlFromAllowedOrigin, issueTitle } from './bug-report-lib.mjs'

const MAX_BODY_BYTES = 20_000
const MAX_MESSAGE = 2_000
const MAX_LOGS = 6_000
const MAX_URL = 500
// KV-fallback rate limit, kept in step with [[ratelimits]] (5 per 60 s).
const RL_MAX = 5
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
    console.warn('bug-report turnstile siteverify network error', {
      error: String(e),
    })
    return false
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin')
    const headers = { ...cors(env, origin) }
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    if (request.method === 'OPTIONS') return new Response(null, { headers })
    if (request.method !== 'POST')
      return json({ error: 'method not allowed' }, 405, headers)

    // Fail CLOSED without an anti-abuse control.
    if (!env.RATE_LIMITER && !env.RL && !env.TURNSTILE_SECRET)
      return json(
        { error: 'reporting disabled: configure a rate limit or Turnstile' },
        503,
        headers,
      )

    if (origin && !originAllowed(env, origin))
      return json({ error: 'forbidden origin' }, 403, headers)

    const len = parseInt(request.headers.get('Content-Length') || '0', 10)
    if (len > MAX_BODY_BYTES)
      return json({ error: 'payload too large' }, 413, headers)

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'

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

    let body
    try {
      const raw = await request.text()
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES)
        return json({ error: 'payload too large' }, 413, headers)
      body = JSON.parse(raw)
    } catch {
      return json({ error: 'invalid json' }, 400, headers)
    }

    if (env.TURNSTILE_SECRET) {
      const ok = await verifyTurnstile(
        body?.turnstileToken,
        env.TURNSTILE_SECRET,
        ip,
      )
      if (!ok) return json({ error: 'verification failed' }, 403, headers)
    }

    const message = String(body?.message ?? '')
      .slice(0, MAX_MESSAGE)
      .trim()
    if (!message) return json({ error: 'empty message' }, 400, headers)

    const ctx = body?.context ?? {}
    const logs = String(body?.logs ?? '').slice(0, MAX_LOGS)

    // Keep the reported URL only if it is from our own site; embed the PARSED
    // href (percent-encodes <>", strips newlines) and defang it too (href does
    // not encode markdown metachars). Length-capped.
    const url = String(ctx.url ?? '').slice(0, MAX_URL)
    const origins = allowedOrigins(env)
    const safeUrl = origins.includes('*')
      ? defang(url)
      : urlFromAllowedOrigin(url, origins)
        ? defang(new URL(url).href)
        : '(omitted)'

    const issueBody = [
      defang(message),
      '',
      '---',
      `Puzzle: ${defang(ctx.date ?? '?')}`,
      `URL: ${safeUrl}`,
      `Browser: ${defang(ctx.userAgent ?? '')}`,
      '',
      '<details><summary>session logs</summary>',
      '',
      '```',
      defang(logs) || '(none)',
      '```',
      '</details>',
    ].join('\n')

    let res
    try {
      res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'CampusPinShowdown-bug-bot',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: issueTitle(message),
          body: issueBody,
          labels: ['bug', 'from-app'],
        }),
      })
    } catch (e) {
      console.error('bug-report github issue create threw', {
        error: String(e),
      })
      return json({ error: 'github error' }, 502, headers)
    }
    if (!res.ok) {
      // Log status AND the GitHub error body (expired PAT, archived repo,
      // secondary rate limit) — never the token.
      const detail = await res.text().catch(() => '')
      console.error('bug-report github issue create failed', {
        status: res.status,
        body: detail.slice(0, 300),
      })
      return json({ error: 'github error', status: res.status }, 502, headers)
    }
    const issue = await res.json()
    return json({ ok: true, url: issue.html_url }, 200, headers)
  },
}
