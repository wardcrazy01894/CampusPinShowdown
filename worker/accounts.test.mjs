import { describe, it, expect, beforeEach } from 'vitest'
import { freshDb } from './d1-test-helper.mjs'
import {
  accountKey,
  isValidToken,
  isValidPass,
  validateName,
  validateUsername,
  validateStreakClaim,
  mergeStreaks,
  hashPass,
  safeEqual,
  createAccount,
  verifyLogin,
  openSession,
  closeSession,
  accountForToken,
  renameAccount,
  foldIntoAccount,
  readProgress,
  MAX_SESSIONS_PER_ACCOUNT,
} from './accounts-lib.mjs'
import {
  isValidClientId,
  validateRounds,
  validateSubmission,
  upsertAndRank,
  updateStreak,
  topScores,
} from './leaderboard-lib.mjs'

/**
 * Accounts: validation, the streak merge that lets an account INHERIT the
 * streaks already built on its devices, and the SQL (real node:sqlite, real
 * migrations) behind register / sign in / fold / progress.
 */

const NOW = new Date('2026-11-12T15:00:00Z')
const MS = NOW.getTime()
const PASS = 'a'.repeat(64)
const ROUNDS = [
  [42.28, -83.74, 100, 0],
  [30.1, -97.7, 90, 0],
  [40, -105.2, 80, 1],
  [35.9, -79, 70, 0],
  [44, -123, 60, 0],
]
const ROUNDS_JSON = JSON.stringify(ROUNDS)

describe('validation', () => {
  it('an account key can never be a browser-minted device id', () => {
    expect(accountKey(12)).toBe('acct:12')
    expect(isValidClientId(accountKey(12))).toBe(false)
  })

  it('tokens are 48 hex chars, password keys 64', () => {
    expect(isValidToken('f'.repeat(48))).toBe(true)
    expect(isValidToken('f'.repeat(47))).toBe(false)
    expect(isValidToken(undefined)).toBe(false)
    expect(isValidPass(PASS)).toBe(true)
    expect(isValidPass('hunter2')).toBe(false)
  })

  it('usernames are 3–20 of a-z 0-9 _, lowercased — an email is refused', () => {
    expect(validateUsername('  Spicy_Al ')).toEqual({
      ok: true,
      value: 'spicy_al',
    })
    expect(validateUsername('al').ok).toBe(false)
    const email = validateUsername('al@example.com')
    expect(email.ok).toBe(false)
    expect(email.error).toMatch(/not an email/i)
    expect(validateUsername('sh1t_head').ok).toBe(false)
  })

  it("display names are 2–20 Latin letters, digits, space and _ . - '", () => {
    expect(validateName("  Spicy   Al's ")).toEqual({
      ok: true,
      value: "Spicy Al's",
    })
    expect(validateName('x').ok).toBe(false)
    expect(validateName('a'.repeat(21)).ok).toBe(false)
    expect(validateName('<b>hi</b>').ok).toBe(false)
    expect(validateName('F.U.C.K').ok).toBe(false)
    // Cyrillic lookalike of "Al".
    expect(validateName('Аl').ok).toBe(false)
  })
})

describe('validateRounds (the per-round detail behind a score)', () => {
  it('normalises five [lat, lng, score, hinted] rounds that add up', () => {
    const v = validateRounds(ROUNDS, 400)
    expect(v.ok).toBe(true)
    expect(JSON.parse(v.value)).toEqual(ROUNDS)
  })
  it('absent is fine (older clients send none)', () => {
    expect(validateRounds(undefined, 400)).toEqual({ ok: true, value: null })
  })
  it('rejects a detail that does not add up to the score', () => {
    expect(validateRounds(ROUNDS, 500).ok).toBe(false)
  })
  it('rejects the wrong count, out-of-range coordinates or scores', () => {
    expect(validateRounds(ROUNDS.slice(0, 4), 340).ok).toBe(false)
    const bad = (i, v) => ROUNDS.map((r, n) => (n === 0 ? v(r) : r))
    expect(
      validateRounds(
        bad(0, () => [95, 0, 100, 0]),
        400,
      ).ok,
    ).toBe(false)
    expect(
      validateRounds(
        bad(0, () => [0, 0, 100.5, 0]),
        400,
      ).ok,
    ).toBe(false)
    expect(
      validateRounds(
        bad(0, () => 'x'),
        400,
      ).ok,
    ).toBe(false)
    expect(validateRounds('nope', 400).ok).toBe(false)
  })
  it('validateSubmission carries the normalised rounds', () => {
    const v = validateSubmission(
      {
        board: 'usa',
        date: '2026-11-12',
        score: 400,
        clientId: 'device-aaaa',
        lineup: 'abc',
        rounds: ROUNDS,
      },
      NOW,
    )
    expect(v.ok).toBe(true)
    expect(v.value.rounds).toBe(ROUNDS_JSON)
  })
})

describe('validateStreakClaim (a device vouching for its local streak)', () => {
  const claim = (over = {}) => ({
    current: 5,
    best: 9,
    last: '2026-11-12',
    ...over,
  })
  it('accepts a plausible streak', () => {
    expect(validateStreakClaim(claim(), NOW)).toEqual({
      current: 5,
      best: 9,
      last_played_date: '2026-11-12',
    })
  })
  it('ignores a future day, a pre-launch day and junk', () => {
    expect(validateStreakClaim(claim({ last: '2026-11-20' }), NOW)).toBeNull()
    expect(validateStreakClaim(claim({ last: '2026-10-01' }), NOW)).toBeNull()
    expect(validateStreakClaim(claim({ last: 'x' }), NOW)).toBeNull()
    expect(validateStreakClaim(claim({ current: 0 }), NOW)).toBeNull()
    expect(validateStreakClaim(claim({ current: 2.5 }), NOW)).toBeNull()
    expect(validateStreakClaim(claim({ best: 3 }), NOW)).toBeNull()
    expect(validateStreakClaim(null, NOW)).toBeNull()
  })
  it('ignores a streak longer than the game has existed', () => {
    // Puzzle #1 was 2026-10-29, so by 11-12 the longest possible run is 15.
    expect(
      validateStreakClaim(claim({ current: 15, best: 15 }), NOW),
    ).not.toBeNull()
    expect(
      validateStreakClaim(claim({ current: 16, best: 16 }), NOW),
    ).toBeNull()
  })
})

describe('mergeStreaks (two devices, one account)', () => {
  const s = (current, last, best = current) => ({
    current,
    best,
    last_played_date: last,
  })
  it('both played the same last day: the LONGER streak wins', () => {
    expect(mergeStreaks(s(12, '2026-11-12'), s(5, '2026-11-12'))).toEqual(
      s(12, '2026-11-12'),
    )
    expect(mergeStreaks(s(5, '2026-11-11'), s(12, '2026-11-11'))).toEqual(
      s(12, '2026-11-11'),
    )
  })
  it('one device played today, the longer one yesterday: the run continues', () => {
    expect(mergeStreaks(s(12, '2026-11-11'), s(5, '2026-11-12'))).toEqual(
      s(13, '2026-11-12'),
    )
  })
  it('a streak that already lapsed does not come back, but its best counts', () => {
    expect(mergeStreaks(s(12, '2026-11-01'), s(5, '2026-11-12'))).toEqual(
      s(5, '2026-11-12', 12),
    )
  })
  it('a missing side is the other side', () => {
    expect(mergeStreaks(null, s(3, '2026-11-12'))).toEqual(s(3, '2026-11-12'))
    expect(mergeStreaks(s(3, '2026-11-12'), undefined)).toEqual(
      s(3, '2026-11-12'),
    )
  })
})

describe('password hashing', () => {
  it('is salted and compared in constant time', async () => {
    const a = await hashPass(PASS, '00'.repeat(16))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashPass(PASS, '00'.repeat(16))).toBe(a)
    expect(await hashPass(PASS, '11'.repeat(16))).not.toBe(a)
    expect(safeEqual(a, a)).toBe(true)
    expect(safeEqual(a, a.slice(1) + '0')).toBe(false)
    expect(safeEqual(a, 'short')).toBe(false)
  })
})

describe('accounts in D1', () => {
  let db
  beforeEach(() => {
    db = freshDb()
  })
  const make = (username = 'spicy_al', name = '') =>
    createAccount(db, { username, name, pass: PASS }, MS)

  it('creates an account; the display name defaults to the username', async () => {
    const r = await make()
    expect(r.ok).toBe(true)
    expect(r.value).toMatchObject({ username: 'spicy_al', name: 'spicy_al' })
    expect((await make('other', 'Big Al')).value.name).toBe('Big Al')
  })

  it('refuses a taken username with 409', async () => {
    await make()
    expect(await make()).toMatchObject({ ok: false, status: 409 })
  })

  it('signs in with the right password only, same error either way', async () => {
    await make()
    expect((await verifyLogin(db, 'spicy_al', PASS)).ok).toBe(true)
    const wrong = await verifyLogin(db, 'spicy_al', 'b'.repeat(64))
    const nobody = await verifyLogin(db, 'nobody', PASS)
    expect(wrong).toMatchObject({ ok: false, status: 401 })
    expect(nobody).toEqual(wrong)
  })

  it('never stores the password key itself', async () => {
    await make()
    const row = await db.prepare(`SELECT * FROM accounts`).first()
    expect(JSON.stringify(row)).not.toContain(PASS)
  })

  it('a session token resolves to its account until signed out', async () => {
    const { value: acct } = await make()
    const token = await openSession(db, acct.id, MS)
    expect(isValidToken(token)).toBe(true)
    expect(await accountForToken(db, token)).toMatchObject({
      id: acct.id,
      username: 'spicy_al',
    })
    // Only the hash is at rest.
    const row = await db.prepare(`SELECT * FROM sessions`).first()
    expect(row.token_hash).not.toBe(token)
    await closeSession(db, token)
    expect(await accountForToken(db, token)).toBeNull()
    expect(await accountForToken(db, 'not-a-token')).toBeNull()
  })

  it('keeps only the newest few sessions per account', async () => {
    const { value: acct } = await make()
    const first = await openSession(db, acct.id, MS)
    for (let i = 1; i <= MAX_SESSIONS_PER_ACCOUNT; i++)
      await openSession(db, acct.id, MS + i)
    expect(await accountForToken(db, first)).toBeNull()
    const n = await db.prepare(`SELECT COUNT(*) AS n FROM sessions`).first()
    expect(n.n).toBe(MAX_SESSIONS_PER_ACCOUNT)
  })

  it('renames', async () => {
    const { value: acct } = await make()
    await renameAccount(db, acct.id, 'Big Al')
    const token = await openSession(db, acct.id, MS)
    expect((await accountForToken(db, token)).name).toBe('Big Al')
  })

  describe('foldIntoAccount — inheriting what a device already has', () => {
    const DAY = '2026-11-12'
    const submit = (clientId, score, date = DAY, rounds = null) =>
      upsertAndRank(
        db,
        { board: 'usa', date, clientId, score, lineup: 'aaaa', rounds },
        MS,
      )
    const streakOf = (key) =>
      db
        .prepare(
          `SELECT current, best, last_played_date FROM streaks WHERE client_id = ?1`,
        )
        .bind(key)
        .first()

    it("moves the device's scores and streak to the account (no anonymous twin)", async () => {
      const { value: acct } = await make()
      await submit('device-comp', 400, DAY, ROUNDS_JSON)
      await updateStreak(
        db,
        { board: 'usa', clientId: 'device-comp', date: '2026-11-11' },
        MS,
      )
      await updateStreak(
        db,
        { board: 'usa', clientId: 'device-comp', date: DAY },
        MS,
      )
      await foldIntoAccount(db, 'usa', acct.id, { clientId: 'device-comp' }, MS)
      expect(await topScores(db, 'usa', DAY)).toMatchObject({
        total: 1,
        scores: [400],
        names: ['spicy_al'],
      })
      expect(await streakOf('acct:1')).toEqual({
        current: 2,
        best: 2,
        last_played_date: DAY,
      })
      expect(await streakOf('device-comp')).toBeNull()
    })

    it('two devices with different streaks: the account keeps the longer', async () => {
      const { value: acct } = await make()
      // The computer vouches for 12 days, the phone for 5 — both played today.
      await foldIntoAccount(
        db,
        'usa',
        acct.id,
        {
          clientId: 'device-comp',
          claim: { current: 12, best: 12, last_played_date: DAY },
        },
        MS,
      )
      await foldIntoAccount(
        db,
        'usa',
        acct.id,
        {
          clientId: 'device-phone',
          claim: { current: 5, best: 7, last_played_date: DAY },
        },
        MS,
      )
      expect(await streakOf('acct:1')).toEqual({
        current: 12,
        best: 12,
        last_played_date: DAY,
      })
      // And it carries on from there, whichever device plays next.
      expect(
        await updateStreak(
          db,
          { board: 'usa', clientId: 'acct:1', date: '2026-11-13' },
          MS,
        ),
      ).toEqual({ current: 13, best: 13 })
    })

    it('the same day played on both devices is one row, the better score', async () => {
      const { value: acct } = await make()
      await submit('device-comp', 300, DAY, JSON.stringify([[1, 1, 300, 0]]))
      await submit('device-phone', 450, DAY, ROUNDS_JSON)
      await foldIntoAccount(db, 'usa', acct.id, { clientId: 'device-comp' }, MS)
      await foldIntoAccount(
        db,
        'usa',
        acct.id,
        { clientId: 'device-phone' },
        MS,
      )
      expect(await topScores(db, 'usa', DAY)).toMatchObject({
        total: 1,
        scores: [450],
      })
      const row = await db
        .prepare(`SELECT score, rounds FROM scores WHERE client_id = 'acct:1'`)
        .first()
      expect(row).toEqual({ score: 450, rounds: ROUNDS_JSON })
    })

    it('never folds another ACCOUNT, and ignores a junk device id', async () => {
      const { value: a } = await make('first')
      const { value: b } = await make('second')
      await submit(accountKey(a.id), 400)
      await foldIntoAccount(db, 'usa', b.id, { clientId: accountKey(a.id) }, MS)
      await foldIntoAccount(db, 'usa', b.id, { clientId: null }, MS)
      expect((await topScores(db, 'usa', DAY)).names).toEqual(['first'])
    })
  })

  describe('readProgress — what another device needs', () => {
    it('returns the streak and the recent days with their rounds', async () => {
      const { value: acct } = await make()
      const key = accountKey(acct.id)
      await upsertAndRank(
        db,
        {
          board: 'usa',
          date: '2026-11-12',
          clientId: key,
          score: 400,
          lineup: 'aaaa',
          rounds: ROUNDS_JSON,
        },
        MS,
      )
      // Outside the submission window: not sent.
      await upsertAndRank(
        db,
        {
          board: 'usa',
          date: '2026-11-01',
          clientId: key,
          score: 100,
          lineup: 'old',
        },
        MS,
      )
      await updateStreak(
        db,
        { board: 'usa', clientId: key, date: '2026-11-12' },
        MS,
      )
      expect(await readProgress(db, 'usa', acct.id, NOW)).toEqual({
        streak: { current: 1, best: 1, last: '2026-11-12' },
        days: [
          { date: '2026-11-12', lineup: 'aaaa', score: 400, rounds: ROUNDS },
        ],
      })
    })

    it('is empty for a brand-new account', async () => {
      const { value: acct } = await make()
      expect(await readProgress(db, 'usa', acct.id, NOW)).toEqual({
        streak: null,
        days: [],
      })
    })
  })
})

describe('upsertAndRank keeps rounds in step with the stored score', () => {
  let db
  beforeEach(() => {
    db = freshDb()
  })
  const put = (score, rounds) =>
    upsertAndRank(
      db,
      {
        board: 'usa',
        date: '2026-11-12',
        clientId: 'device-aaaa',
        score,
        lineup: 'aaaa',
        rounds,
      },
      MS,
    )
  const stored = () =>
    db.prepare(`SELECT score, rounds FROM scores`).bind().first()

  it('a lower re-submit changes nothing', async () => {
    await put(400, 'A')
    await put(300, 'B')
    expect(await stored()).toEqual({ score: 400, rounds: 'A' })
  })
  it('a higher one replaces both', async () => {
    await put(300, 'B')
    await put(400, 'A')
    expect(await stored()).toEqual({ score: 400, rounds: 'A' })
  })
  it('the same score fills in rounds a pre-accounts row lacked', async () => {
    await put(400, null)
    await put(400, 'A')
    expect(await stored()).toEqual({ score: 400, rounds: 'A' })
  })
})
