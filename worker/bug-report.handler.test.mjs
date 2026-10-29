import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler from './bug-report.mjs'

/**
 * Handler-level tests: the whole request path with a mocked `env` and a mocked
 * global `fetch` (Turnstile siteverify + GitHub API), so the abuse-control
 * branches can't regress silently.
 */

const ORIGIN = 'https://campuspinshowdown.com'

const kv = (count = 0) => ({
  get: vi.fn(async () => (count ? String(count) : null)),
  put: vi.fn(async () => {}),
})

const makeEnv = (over = {}) => ({
  ALLOWED_ORIGIN: ORIGIN,
  GH_REPO: 'owner/repo',
  GH_TOKEN: 'gh-secret',
  RL: kv(0),
  ...over,
})

const post = (body, { origin = ORIGIN, headers = {} } = {}) =>
  new Request('https://worker.example/', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.7',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

let githubCall

beforeEach(() => {
  githubCall = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      const u = String(url)
      if (u.includes('siteverify'))
        return { json: async () => ({ success: globalThis.__turnstileOk }) }
      if (u.includes('api.github.com')) {
        githubCall = { url: u, init, body: JSON.parse(init.body) }
        if (globalThis.__githubThrows) throw new Error('GH_NETWORK_DOWN')
        return globalThis.__githubOk === false
          ? {
              ok: false,
              status: 422,
              json: async () => ({}),
              text: async () => '{"message":"Validation Failed"}',
            }
          : {
              ok: true,
              status: 201,
              json: async () => ({
                html_url: 'https://github.com/owner/repo/issues/1',
              }),
            }
      }
      throw new Error('unexpected fetch ' + u)
    }),
  )
  globalThis.__turnstileOk = true
  globalThis.__githubOk = true
  globalThis.__githubThrows = false
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete globalThis.__turnstileOk
  delete globalThis.__githubOk
  delete globalThis.__githubThrows
})

describe('bug-report worker handler', () => {
  it('answers CORS preflight and rejects non-POST with 405', async () => {
    const pre = await handler.fetch(
      new Request('https://worker.example/', {
        method: 'OPTIONS',
        headers: { Origin: ORIGIN },
      }),
      makeEnv(),
    )
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(pre.headers.get('Access-Control-Allow-Methods')).toBe(
      'POST, OPTIONS',
    )
    const get = await handler.fetch(
      new Request('https://worker.example/', {
        method: 'GET',
        headers: { Origin: ORIGIN },
      }),
      makeEnv(),
    )
    expect(get.status).toBe(405)
  })

  it('fails CLOSED (503) without a rate limit or Turnstile', async () => {
    const res = await handler.fetch(
      post({ message: 'hi' }),
      makeEnv({ RL: undefined }),
    )
    expect(res.status).toBe(503)
  })

  it('rejects a disallowed Origin (403), oversized body (413), rate-limited IP (429), bad JSON (400)', async () => {
    expect(
      (
        await handler.fetch(
          post({ message: 'hi' }, { origin: 'https://evil.example' }),
          makeEnv(),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await handler.fetch(
          post({ message: 'hi' }, { headers: { 'Content-Length': '999999' } }),
          makeEnv(),
        )
      ).status,
    ).toBe(413)
    expect(
      (await handler.fetch(post({ message: 'hi' }), makeEnv({ RL: kv(5) })))
        .status,
    ).toBe(429)
    expect((await handler.fetch(post('{ not json'), makeEnv())).status).toBe(
      400,
    )
  })

  it('uses the native rate limiter when bound', async () => {
    const limit = vi.fn(async () => ({ success: false }))
    const res = await handler.fetch(
      post({ message: 'hi' }),
      makeEnv({ RL: undefined, RATE_LIMITER: { limit } }),
    )
    expect(res.status).toBe(429)
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
  })

  it('rejects a failed Turnstile check (403) and an empty message (400)', async () => {
    globalThis.__turnstileOk = false
    expect(
      (
        await handler.fetch(
          post({ message: 'hi', turnstileToken: 'tok' }),
          makeEnv({ TURNSTILE_SECRET: 'secret' }),
        )
      ).status,
    ).toBe(403)
    expect(
      (await handler.fetch(post({ message: '   ' }), makeEnv())).status,
    ).toBe(400)
  })

  it('files a GitHub issue with the puzzle context and returns its url', async () => {
    const res = await handler.fetch(
      post({
        message: 'the map was grey',
        context: { date: '2026-10-29', url: ORIGIN + '/', userAgent: 'UA' },
        logs: 'l1\nl2',
      }),
      makeEnv(),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      url: 'https://github.com/owner/repo/issues/1',
    })
    expect(githubCall.url).toContain('/repos/owner/repo/issues')
    expect(githubCall.init.headers.Authorization).toBe('Bearer gh-secret')
    expect(githubCall.body.title).toBe('[bug] the map was grey')
    expect(githubCall.body.labels).toEqual(['bug', 'from-app'])
    expect(githubCall.body.body).toContain('Puzzle: 2026-10-29')
    expect(githubCall.body.body).toContain(`URL: ${ORIGIN}/`)
    expect(githubCall.body.body).toContain('l1\nl2')
  })

  it('surfaces a GitHub failure (502) and logs status + body; logs when the call throws', async () => {
    globalThis.__githubOk = false
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r1 = await handler.fetch(post({ message: 'hi' }), makeEnv())
    expect(r1.status).toBe(502)
    expect(JSON.stringify(spy.mock.calls)).toMatch(/422.*Validation Failed/)
    globalThis.__githubOk = true
    globalThis.__githubThrows = true
    const r2 = await handler.fetch(post({ message: 'hi' }), makeEnv())
    expect(r2.status).toBe(502)
    expect(JSON.stringify(spy.mock.calls)).toMatch(/GH_NETWORK_DOWN/)
    // The token never reaches the logs.
    expect(JSON.stringify(spy.mock.calls)).not.toContain('gh-secret')
    spy.mockRestore()
  })

  it('omits a foreign or lookalike-origin URL, keeps an own-origin one parsed + defanged', async () => {
    await handler.fetch(
      post({ message: 'hi', context: { url: 'https://evil.example/steal' } }),
      makeEnv(),
    )
    expect(githubCall.body.body).toContain('URL: (omitted)')
    await handler.fetch(
      post({ message: 'hi', context: { url: ORIGIN + '.evil.com/phish' } }),
      makeEnv(),
    )
    expect(githubCall.body.body).toContain('URL: (omitted)')
    await handler.fetch(
      post({
        message: 'hi',
        context: {
          url: ORIGIN + '/?a=![beacon](https://evil.example/t.png)#<img src=x>',
        },
      }),
      makeEnv(),
    )
    expect(githubCall.body.body).not.toMatch(/!\[/)
    expect(githubCall.body.body).not.toMatch(/\]\(/)
    expect(githubCall.body.body).not.toMatch(/<img/i)
    expect(githubCall.body.body).toContain(`URL: ${ORIGIN}/`)
  })

  it('defangs a markdown link in the message and caps an oversized body without Content-Length', async () => {
    await handler.fetch(
      post({ message: 'bug [click](https://evil.example/phish)' }),
      makeEnv(),
    )
    expect(githubCall.body.body).not.toMatch(/\]\(/)
    githubCall = null
    const res = await handler.fetch(
      post({ message: 'hi', logs: 'x'.repeat(30_000) }),
      makeEnv(),
    )
    expect(res.status).toBe(413)
    expect(githubCall).toBeNull()
  })
})
