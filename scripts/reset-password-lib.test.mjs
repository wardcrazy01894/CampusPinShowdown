import { describe, it, expect } from 'vitest'
import { freshDb } from '../worker/d1-test-helper.mjs'
import {
  createAccount,
  verifyLogin,
  openSession,
  accountForToken,
} from '../worker/accounts-lib.mjs'
import { derivePass } from '../src/lib/account.ts'
import {
  clientKey,
  tempPassword,
  resetStatements,
} from './reset-password-lib.mjs'

/**
 * The owner's "a friend forgot their password" tool. The script itself only
 * shells out to wrangler; everything that could go wrong is here.
 */

describe('clientKey', () => {
  it('is exactly the key the browser derives at sign-in', async () => {
    expect(await clientKey('Spicy_Al', 'correct horse')).toBe(
      await derivePass('Spicy_Al', 'correct horse'),
    )
  }, 30_000)
})

describe('tempPassword', () => {
  it('is long enough to sign in with, easy to read out, and different each time', () => {
    const a = tempPassword()
    expect(a).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/)
    // No look-alikes to get wrong over a text message.
    expect(a).not.toMatch(/[01lo]/)
    expect(tempPassword()).not.toBe(a)
  })
})

describe('resetStatements', () => {
  it('refuses anything that is not a valid username (it goes into SQL)', async () => {
    await expect(
      resetStatements("al'; DROP TABLE accounts;--", 'x'),
    ).rejects.toThrow(/username/)
    await expect(resetStatements('al@example.com', 'x')).rejects.toThrow()
  })

  it('sets the new password, signs the account out everywhere, and keeps everything else', async () => {
    const db = freshDb()
    const old = await clientKey('spicy_al', 'old password')
    const { value: acct } = await createAccount(
      db,
      { username: 'spicy_al', name: 'Spicy Al', pass: old },
      1,
    )
    const token = await openSession(db, acct.id, 1)
    await db
      .prepare(
        `INSERT INTO streaks (board, client_id, current, best, last_played_date, updated_at)
         VALUES ('usa', 'acct:1', 12, 12, '2026-11-12', 1)`,
      )
      .run()

    const temp = tempPassword()
    // Typed with capitals and spaces: usernames are case-insensitive.
    const statements = await resetStatements('  Spicy_Al ', temp)
    for (const sql of statements) {
      expect(sql).not.toContain(temp) // the password itself is never stored
      await db.prepare(sql).run()
    }

    const key = await clientKey('spicy_al', temp)
    expect((await verifyLogin(db, 'spicy_al', key)).ok).toBe(true)
    expect((await verifyLogin(db, 'spicy_al', old)).ok).toBe(false)
    expect(await accountForToken(db, token)).toBeNull()
    const kept = await db
      .prepare(`SELECT name FROM accounts WHERE username = 'spicy_al'`)
      .first()
    expect(kept.name).toBe('Spicy Al')
    const streak = await db.prepare(`SELECT current FROM streaks`).first()
    expect(streak.current).toBe(12)
  }, 30_000)
})
