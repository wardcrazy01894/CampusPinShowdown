import { describe, it, expect, beforeEach, vi } from 'vitest'
import handler from './leaderboard.mjs'
import { utcDateKey, previousDateKey } from './leaderboard-lib.mjs'
import { freshDb } from './d1-test-helper.mjs'

/**
 * The account routes end to end: the Worker's `fetch` against a real SQLite
 * with the real migrations. The story under test is the owner's: a streak on
 * the computer, a shorter one on the phone, one account — both devices end up
 * on the longer streak and each knows what the other finished today.
 */

const ORIGIN = 'https://campuspinshowdown.com'
const TODAY = utcDateKey(new Date())
const YESTERDAY = previousDateKey(TODAY)
const PASS = 'a'.repeat(64)
const COMPUTER = 'device-computer-0001'
const PHONE = 'device-phone-0002'
const ROUNDS = [
  [42.28, -83.74, 100, 0],
  [30.1, -97.7, 90, 0],
  [40, -105.2, 80, 1],
  [35.9, -79, 70, 0],
  [44, -123, 60, 0],
]

let env
beforeEach(() => {
  env = {
    ALLOWED_ORIGIN: ORIGIN,
    DB: freshDb(),
    RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    LOGIN_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
  }
})

async function call(path, body, method = 'POST') {
  const res = await handler.fetch(
    new Request(`https://worker.example${path}`, {
      method,
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.7',
      },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
    env,
  )
  return { status: res.status, ...(await res.json()) }
}
const submit = (over) =>
  call('/', {
    board: 'usa',
    date: TODAY,
    score: 400,
    lineup: 'aaaa',
    rounds: ROUNDS,
    ...over,
  })
const board = () => call(`/?board=usa&date=${TODAY}`, null, 'GET')

describe('register', () => {
  it('creates the account and signs this device in', async () => {
    const r = await call('/register', {
      username: 'Spicy_Al',
      pass: PASS,
      name: 'Spicy Al',
    })
    expect(r).toMatchObject({
      status: 200,
      ok: true,
      username: 'spicy_al',
      name: 'Spicy Al',
    })
    expect(r.token).toMatch(/^[0-9a-f]{48}$/)
    const me = await call('/me', { token: r.token })
    expect(me).toMatchObject({
      status: 200,
      username: 'spicy_al',
      name: 'Spicy Al',
      streak: null,
      days: [],
    })
  })

  it('says a username is not an email', async () => {
    const r = await call('/register', { username: 'al@umich.edu', pass: PASS })
    expect(r.status).toBe(400)
    expect(r.error).toMatch(/not an email/)
  })

  it('rejects a bad display name, a raw password and a taken username', async () => {
    expect(
      (await call('/register', { username: 'al_one', pass: PASS, name: '<i>' }))
        .status,
    ).toBe(400)
    expect(
      (await call('/register', { username: 'al_one', pass: 'hunter2' })).status,
    ).toBe(400)
    await call('/register', { username: 'al_one', pass: PASS })
    expect(
      (await call('/register', { username: 'AL_ONE', pass: PASS })).status,
    ).toBe(409)
  })

  it('fails closed without the login limiter, and honours it', async () => {
    env.LOGIN_LIMITER = undefined
    expect(
      (await call('/register', { username: 'al_one', pass: PASS })).status,
    ).toBe(503)
    env.LOGIN_LIMITER = { limit: vi.fn(async () => ({ success: false })) }
    expect(
      (await call('/register', { username: 'al_one', pass: PASS })).status,
    ).toBe(429)
    expect(
      (await call('/login', { username: 'al_one', pass: PASS })).status,
    ).toBe(429)
    expect(env.LOGIN_LIMITER.limit).toHaveBeenLastCalledWith({
      key: '203.0.113.7|al_one',
    })
  })
})

describe('login / logout / name', () => {
  beforeEach(async () => {
    await call('/register', { username: 'spicy_al', pass: PASS })
  })

  it('signs in with the right password; one error for every failure', async () => {
    const ok = await call('/login', { username: 'spicy_al', pass: PASS })
    expect(ok).toMatchObject({ status: 200, username: 'spicy_al' })
    const wrong = await call('/login', {
      username: 'spicy_al',
      pass: 'b'.repeat(64),
    })
    const nobody = await call('/login', { username: 'nobody', pass: PASS })
    const junk = await call('/login', { username: '!', pass: 'x' })
    for (const r of [wrong, nobody, junk])
      expect(r).toMatchObject({
        status: 401,
        error: 'wrong username or password',
      })
  })

  it('logout ends the session: /me then answers 401', async () => {
    const { token } = await call('/login', { username: 'spicy_al', pass: PASS })
    expect((await call('/logout', { token })).status).toBe(200)
    expect((await call('/me', { token })).status).toBe(401)
  })

  it('sets the display name, which the board then shows', async () => {
    const { token } = await call('/login', { username: 'spicy_al', pass: PASS })
    const r = await call('/name', { token, name: '  Big   Al ' })
    expect(r).toMatchObject({ status: 200, name: 'Big Al' })
    expect((await call('/name', { token, name: 'x' })).status).toBe(400)
    expect(
      (await call('/name', { token: 'f'.repeat(48), name: 'Big Al' })).status,
    ).toBe(401)
    await submit({ clientId: COMPUTER, token })
    expect(await board()).toMatchObject({ scores: [400], names: ['Big Al'] })
  })
})

describe('change password (signed in)', () => {
  const NEW = 'c'.repeat(64)
  let token
  beforeEach(async () => {
    token = (await call('/register', { username: 'spicy_al', pass: PASS }))
      .token
  })

  it('needs the current password, then only the new one signs in', async () => {
    const wrong = await call('/password', {
      token,
      pass: 'b'.repeat(64),
      newPass: NEW,
    })
    expect(wrong).toMatchObject({ status: 401, error: 'wrong password' })
    const ok = await call('/password', { token, pass: PASS, newPass: NEW })
    expect(ok).toMatchObject({ status: 200, ok: true, username: 'spicy_al' })
    expect(
      (await call('/login', { username: 'spicy_al', pass: PASS })).status,
    ).toBe(401)
    expect(
      (await call('/login', { username: 'spicy_al', pass: NEW })).status,
    ).toBe(200)
  })

  it('keeps this device signed in and signs every other device out', async () => {
    const other = await call('/login', { username: 'spicy_al', pass: PASS })
    await call('/password', { token, pass: PASS, newPass: NEW })
    expect((await call('/me', { token })).status).toBe(200)
    expect((await call('/me', { token: other.token })).status).toBe(401)
  })

  it('rejects a malformed new password, a dead session, and is rate limited like login', async () => {
    expect(
      (await call('/password', { token, pass: PASS, newPass: 'hunter2' }))
        .status,
    ).toBe(400)
    expect(
      (
        await call('/password', {
          token: 'f'.repeat(48),
          pass: PASS,
          newPass: NEW,
        })
      ).status,
    ).toBe(401)
    env.LOGIN_LIMITER = { limit: vi.fn(async () => ({ success: false })) }
    expect(
      (await call('/password', { token, pass: PASS, newPass: NEW })).status,
    ).toBe(429)
    expect(env.LOGIN_LIMITER.limit).toHaveBeenLastCalledWith({
      key: '203.0.113.7|spicy_al',
    })
  })
})

describe('one account, two devices', () => {
  it('a signed-in score is one board row however many devices post it', async () => {
    const { token } = await call('/register', {
      username: 'spicy_al',
      pass: PASS,
    })
    const phone = await call('/login', { username: 'spicy_al', pass: PASS })
    await submit({ clientId: COMPUTER, token })
    const again = await submit({ clientId: PHONE, token: phone.token })
    expect(again).toMatchObject({ rank: 1, total: 1 })
    expect(await board()).toMatchObject({ total: 1, names: ['spicy_al'] })
  })

  it('the other device learns today is done, with the score and rounds', async () => {
    const { token } = await call('/register', {
      username: 'spicy_al',
      pass: PASS,
    })
    await submit({ clientId: COMPUTER, token })
    const phone = await call('/login', {
      username: 'spicy_al',
      pass: PASS,
      clientId: PHONE,
    })
    const me = await call('/me', { token: phone.token })
    expect(me.days).toEqual([
      { date: TODAY, lineup: 'aaaa', score: 400, rounds: ROUNDS },
    ])
    expect(me.streak).toEqual({ current: 1, best: 1, last: TODAY })
  })

  it('inherits the LONGER of two device streaks and keeps them in step', async () => {
    // Both devices played anonymously before the account existed. The
    // computer's local streak is 12, the phone's 5 (the server's own table
    // only saw today, so the devices vouch for the rest).
    await submit({ clientId: COMPUTER })
    await submit({ clientId: PHONE, score: 300, rounds: undefined })
    const reg = await call('/register', {
      username: 'spicy_al',
      pass: PASS,
      clientId: COMPUTER,
    })
    const a = await call('/me', {
      token: reg.token,
      streak: { current: 12, best: 12, last: TODAY },
    })
    expect(a.streak).toEqual({ current: 12, best: 12, last: TODAY })

    const phone = await call('/login', {
      username: 'spicy_al',
      pass: PASS,
      clientId: PHONE,
    })
    const b = await call('/me', {
      token: phone.token,
      streak: { current: 5, best: 8, last: TODAY },
    })
    expect(b.streak).toEqual({ current: 12, best: 12, last: TODAY })
    // The two anonymous rows became the account's single row.
    expect(await board()).toMatchObject({
      total: 1,
      scores: [400],
      names: ['spicy_al'],
    })
  })

  it('a phone that last played yesterday continues the run, not restarts it', async () => {
    const reg = await call('/register', { username: 'spicy_al', pass: PASS })
    await call('/me', {
      token: reg.token,
      streak: { current: 7, best: 7, last: YESTERDAY },
    })
    const done = await submit({ clientId: PHONE, token: reg.token })
    expect(done.streak).toEqual({ current: 8, best: 8 })
  })

  it('ignores an impossible streak claim', async () => {
    const reg = await call('/register', { username: 'spicy_al', pass: PASS })
    const me = await call('/me', {
      token: reg.token,
      streak: { current: 9999, best: 9999, last: TODAY },
    })
    expect(me.streak).toBeNull()
  })

  it('a submit with a dead token still counts, as the anonymous device', async () => {
    const r = await submit({ clientId: COMPUTER, token: 'f'.repeat(48) })
    expect(r).toMatchObject({ status: 200, rank: 1 })
    expect(await board()).toMatchObject({ names: [''] })
  })
})

describe('register is not left half-done', () => {
  it('still signs in when folding the device’s rows fails (the next sign-in folds them)', async () => {
    const real = env.DB
    env.DB = {
      ...real,
      prepare: (sql) => {
        if (/DELETE FROM scores WHERE client_id/.test(sql))
          throw new Error('FOLD_D1_ERROR')
        return real.prepare(sql)
      },
    }
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await call('/register', {
      username: 'spicy_al',
      pass: PASS,
      clientId: COMPUTER,
    })
    expect(r).toMatchObject({ status: 200, username: 'spicy_al' })
    expect(r.token).toMatch(/^[0-9a-f]{48}$/)
    expect(JSON.stringify(spy.mock.calls)).toMatch(/FOLD_D1_ERROR/)
    spy.mockRestore()
  })
})

describe('routing', () => {
  it('account routes are POST-only JSON and share the abuse controls', async () => {
    env.RATE_LIMITER = { limit: vi.fn(async () => ({ success: false })) }
    expect((await call('/me', { token: 'f'.repeat(48) })).status).toBe(429)
  })

  it('works behind a path prefix (the last segment is the route)', async () => {
    const r = await call('/api/register', { username: 'spicy_al', pass: PASS })
    expect(r.status).toBe(200)
  })

  it('an account-route DB failure is a logged 503, never a 500', async () => {
    env.DB = {
      prepare: () => {
        throw new Error('D1_DOWN')
      },
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await call('/register', { username: 'spicy_al', pass: PASS })
    expect(r.status).toBe(503)
    expect(JSON.stringify(spy.mock.calls)).toMatch(/D1_DOWN/)
    spy.mockRestore()
  })
})
