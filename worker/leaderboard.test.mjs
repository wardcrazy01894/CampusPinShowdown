import { describe, it, expect } from 'vitest'
import {
  MAX_TOTAL,
  BOARDS,
  utcDateKey,
  validDateKeys,
  isValidScore,
  isValidClientId,
  isValidDateKey,
  isValidLineup,
  validateView,
  validateSubmission,
  cutoffDateKey,
  RETENTION_DAYS,
  previousDateKey,
  advanceStreak,
  allowedOrigins,
  originAllowed,
  cors,
} from './leaderboard-lib.mjs'

/**
 * Pure-helper tests for the leaderboard Worker: the validation gates that keep
 * junk out of D1 (unknown boards, forged dates, impossible scores). The full
 * request path is covered in leaderboard.handler.test.mjs; the SQL semantics
 * in leaderboard-db.test.mjs.
 */

describe('validDateKeys', () => {
  it('accepts UTC today ±1 and the day before yesterday (local-midnight puzzles)', () => {
    // A player in UTC+14 is already on the 16th; a UTC-10 player who started
    // the 13th and finished after their midnight submits the 13th.
    const now = new Date('2026-06-15T12:00:00Z')
    const keys = validDateKeys(now)
    expect([...keys].sort()).toEqual([
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
      '2026-06-16',
    ])
    expect(keys.has('2026-06-12')).toBe(false)
    expect(keys.has('2026-06-17')).toBe(false)
  })
  it('utcDateKey formats the UTC day', () => {
    expect(utcDateKey(new Date('2026-06-15T23:59:59Z'))).toBe('2026-06-15')
  })
})

describe('isValidScore', () => {
  it('accepts integers in [0, MAX_TOTAL]', () => {
    expect(isValidScore(0)).toBe(true)
    expect(isValidScore(MAX_TOTAL)).toBe(true)
    expect(isValidScore(317)).toBe(true)
  })
  it('rejects out-of-range, floats, NaN, and non-numbers', () => {
    expect(isValidScore(-1)).toBe(false)
    expect(isValidScore(MAX_TOTAL + 1)).toBe(false)
    expect(isValidScore(12.5)).toBe(false)
    expect(isValidScore(NaN)).toBe(false)
    expect(isValidScore('500')).toBe(false)
    expect(isValidScore(undefined)).toBe(false)
  })
})

describe('isValidClientId', () => {
  it('accepts a crypto.randomUUID-shaped id', () => {
    expect(isValidClientId('3f1a9c2e-7b4d-4e1a-9c2e-7b4d4e1a9c2e')).toBe(true)
  })
  it('rejects empty, too-short, too-long, or unsafe-charset ids', () => {
    expect(isValidClientId('')).toBe(false)
    expect(isValidClientId('short')).toBe(false)
    expect(isValidClientId('x'.repeat(65))).toBe(false)
    expect(isValidClientId('has spaces!!')).toBe(false)
    expect(isValidClientId(42)).toBe(false)
  })
})

describe('isValidLineup', () => {
  it('accepts base36 up to 16 chars and the empty legacy bucket', () => {
    expect(isValidLineup('')).toBe(true)
    expect(isValidLineup('1a2b3c')).toBe(true)
  })
  // The client's lineupHash is unsigned on purpose (progress.test.ts pins it);
  // pin the server side of the contract too.
  it("rejects a leading '-' (negative-hash regression) and bad charsets", () => {
    expect(isValidLineup('-z9cl16')).toBe(false)
    expect(isValidLineup('NOT/A/HASH')).toBe(false)
    expect(isValidLineup('a'.repeat(17))).toBe(false)
  })
})

describe('BOARDS', () => {
  it('is exactly the one nationwide board today', () => {
    expect([...BOARDS]).toEqual(['usa'])
  })
})

describe('isValidDateKey', () => {
  it('accepts a real date, rejects bad format and impossible dates', () => {
    expect(isValidDateKey('2026-06-15')).toBe(true)
    expect(isValidDateKey('2026-6-15')).toBe(false)
    expect(isValidDateKey('2026-99-99')).toBe(false)
    expect(isValidDateKey('not-a-date')).toBe(false)
  })
})

describe('validateView', () => {
  it('accepts the known board + any valid date (read-only)', () => {
    expect(validateView({ board: 'usa', date: '2020-01-01' })).toEqual({
      ok: true,
      value: { board: 'usa', date: '2020-01-01' },
    })
  })
  it('rejects an unknown board and a malformed date', () => {
    expect(validateView({ board: 'mars', date: '2026-06-15' })).toMatchObject({
      ok: false,
      error: 'unknown board',
    })
    expect(validateView({ board: 'usa', date: 'nope' })).toMatchObject({
      ok: false,
      error: 'invalid date',
    })
  })
})

describe('cutoffDateKey', () => {
  it('is RETENTION_DAYS (90) before now', () => {
    expect(RETENTION_DAYS).toBe(90)
    expect(cutoffDateKey(new Date('2026-06-15T12:00:00Z'))).toBe('2026-03-17')
    expect(cutoffDateKey(new Date('2026-06-15T12:00:00Z'), 1)).toBe(
      '2026-06-14',
    )
  })
})

describe('previousDateKey', () => {
  it('returns the prior calendar day (month + leap boundaries)', () => {
    expect(previousDateKey('2026-06-15')).toBe('2026-06-14')
    expect(previousDateKey('2026-03-01')).toBe('2026-02-28')
    expect(previousDateKey('2028-03-01')).toBe('2028-02-29')
  })
})

describe('advanceStreak', () => {
  it('starts at 1, increments on consecutive days, resets after a gap', () => {
    expect(advanceStreak(null, '2026-06-15')).toEqual({
      current: 1,
      best: 1,
      last_played_date: '2026-06-15',
    })
    expect(
      advanceStreak(
        { current: 3, best: 5, last_played_date: '2026-06-14' },
        '2026-06-15',
      ),
    ).toMatchObject({ current: 4, best: 5 })
    expect(
      advanceStreak(
        { current: 5, best: 5, last_played_date: '2026-06-14' },
        '2026-06-15',
      ),
    ).toMatchObject({ current: 6, best: 6 })
    expect(
      advanceStreak(
        { current: 9, best: 9, last_played_date: '2026-06-10' },
        '2026-06-15',
      ),
    ).toMatchObject({ current: 1, best: 9 })
  })
  it('never rewinds on an OLDER date than the last counted (skew / late finisher)', () => {
    const prev = { current: 4, best: 7, last_played_date: '2026-06-15' }
    expect(advanceStreak(prev, '2026-06-14')).toEqual({
      current: 4,
      best: 7,
      last_played_date: '2026-06-15',
    })
  })
  it('is a no-op on a same-day replay', () => {
    expect(
      advanceStreak(
        { current: 4, best: 7, last_played_date: '2026-06-15' },
        '2026-06-15',
      ),
    ).toMatchObject({ current: 4, best: 7 })
  })
})

describe('origin allowlist + CORS', () => {
  const env = { ALLOWED_ORIGIN: 'https://a.example, http://localhost:5173' }
  it('parses the list and reflects an allowed origin', () => {
    expect(allowedOrigins(env)).toEqual([
      'https://a.example',
      'http://localhost:5173',
    ])
    expect(originAllowed(env, 'https://a.example')).toBe(true)
    expect(originAllowed(env, 'https://evil.example')).toBe(false)
    expect(
      cors(env, 'http://localhost:5173')['Access-Control-Allow-Origin'],
    ).toBe('http://localhost:5173')
    // Disallowed → fall back to the first configured origin (never reflect it).
    expect(
      cors(env, 'https://evil.example')['Access-Control-Allow-Origin'],
    ).toBe('https://a.example')
  })
  it('"*" (or unset) allows everything — dev only', () => {
    expect(originAllowed({}, 'https://anything')).toBe(true)
  })
})

describe('validateSubmission', () => {
  const now = new Date('2026-06-15T16:00:00Z')
  const today = '2026-06-15'
  const CLIENT = '3f1a9c2e-7b4d-4e1a-9c2e-7b4d4e1a9c2e'

  it('accepts a well-formed submission for the board + today', () => {
    const r = validateSubmission(
      { board: 'usa', date: today, score: 420, clientId: CLIENT },
      now,
    )
    expect(r).toEqual({
      ok: true,
      value: {
        board: 'usa',
        date: today,
        score: 420,
        clientId: CLIENT,
        lineup: '',
      },
    })
  })
  it('carries a well-formed lineup hash and rejects a malformed one', () => {
    const base = { board: 'usa', date: today, score: 1, clientId: CLIENT }
    expect(
      validateSubmission({ ...base, lineup: '1a2b3c' }, now).value.lineup,
    ).toBe('1a2b3c')
    expect(
      validateSubmission({ ...base, lineup: '-z9cl16' }, now),
    ).toMatchObject({ ok: false, error: 'invalid lineup' })
  })
  it('rejects an unknown board, out-of-window date, bad score, bad clientId', () => {
    const base = { board: 'usa', date: today, score: 1, clientId: CLIENT }
    expect(validateSubmission({ ...base, board: 'mars' }, now)).toMatchObject({
      ok: false,
      status: 400,
      error: 'unknown board',
    })
    expect(
      validateSubmission({ ...base, date: '2020-01-01' }, now),
    ).toMatchObject({ ok: false, error: 'date out of range' })
    expect(validateSubmission({ ...base, date: 'nope' }, now)).toMatchObject({
      ok: false,
      error: 'date out of range',
    })
    expect(validateSubmission({ ...base, score: 9999 }, now)).toMatchObject({
      ok: false,
      error: 'invalid score',
    })
    expect(
      validateSubmission({ ...base, clientId: 'nope!' }, now),
    ).toMatchObject({ ok: false, error: 'invalid clientId' })
  })
})
