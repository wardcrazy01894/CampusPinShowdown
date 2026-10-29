import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
// node:sqlite needs Node >= 22.5 (package.json `engines` enforces this).
import { DatabaseSync } from 'node:sqlite'
import {
  upsertAndRank,
  topScores,
  updateStreak,
  pruneOldScores,
  pruneIfDue,
} from './leaderboard-lib.mjs'

/**
 * SQL-level tests against a REAL SQLite with the REAL migrations, so the query
 * SEMANTICS (what counts as a competitor, what `total` means) are pinned —
 * the handler tests stub D1 entirely.
 */

/** Minimal D1-shaped adapter over node:sqlite for the lib's query helpers. */
function d1(db) {
  const wrap = (sql, args) => ({
    all: () => db.prepare(sql).all(...args),
    run: () => {
      const info = db.prepare(sql).run(...args)
      return { meta: { changes: Number(info.changes) } }
    },
    first: () => db.prepare(sql).all(...args)[0] ?? null,
  })
  return {
    // Like real D1, an unbound statement can run directly (pruneIfDue's
    // marker read has no params) or be bound first.
    prepare: (sql) => ({
      ...wrap(sql, []),
      bind: (...args) => wrap(sql, args),
    }),
    batch: async (stmts) => stmts.map((s) => ({ results: s.all() })),
  }
}

function freshDb() {
  const raw = new DatabaseSync(':memory:')
  const dir = new URL('./migrations/', import.meta.url)
  for (const f of readdirSync(dir).sort()) {
    raw.exec(readFileSync(new URL(f, dir), 'utf8'))
  }
  return d1(raw)
}

let db
beforeEach(() => {
  db = freshDb()
})

const NOW = 1_760_000_000_000
const DAY = '2026-10-29'
const submit = (clientId, score, lineup, date = DAY) =>
  upsertAndRank(db, { board: 'usa', date, clientId, score, lineup }, NOW)

describe('replay-aware standing (one human = one competitor)', () => {
  it('a replayer does not inflate the field: total counts devices, not rows', async () => {
    await submit('device-A', 400, 'aaaa')
    await submit('device-B', 300, 'aaaa')
    await submit('device-A', 350, 'bbbb') // changed set, own row
    const b = await submit('device-B', 300, 'aaaa')
    expect(b.total).toBe(2)
    expect(b.rank).toBe(2)
  })

  it("rank reflects the device's BEST entry of the day", async () => {
    await submit('device-B', 300, 'aaaa')
    await submit('device-A', 400, 'aaaa')
    const a = await submit('device-A', 350, 'bbbb')
    expect(a).toEqual({ rank: 1, total: 2 })
  })

  it('keep-max per lineup (a reload cannot lower a stored score)', async () => {
    await submit('device-A', 400, 'aaaa')
    const again = await submit('device-A', 380, 'aaaa')
    expect(again.rank).toBe(1)
    expect((await topScores(db, 'usa', DAY)).scores).toEqual([400])
  })

  it('ties across devices share a rank (strictly-greater counting)', async () => {
    await submit('device-A', 400, 'aaaa')
    await submit('device-B', 400, 'aaaa')
    const c = await submit('device-C', 300, 'aaaa')
    expect(c).toEqual({ rank: 3, total: 3 })
  })

  it('days are independent', async () => {
    await submit('device-A', 500, 'aaaa', '2026-10-28')
    const b = await submit('device-B', 100, 'bbbb', '2026-10-29')
    expect(b).toEqual({ rank: 1, total: 1 })
  })
})

describe('topScores board (deduped to per-device best)', () => {
  it('shows one row per device — the best — and a device-count total', async () => {
    await submit('device-A', 400, 'aaaa')
    await submit('device-A', 350, 'bbbb')
    await submit('device-B', 300, 'aaaa')
    expect(await topScores(db, 'usa', DAY)).toEqual({
      scores: [400, 300],
      total: 2,
    })
  })

  it('caps the returned rows at the limit but totals the whole field', async () => {
    for (let i = 0; i < 5; i++) await submit(`device-${i}`, 100 + i, 'aaaa')
    expect(await topScores(db, 'usa', DAY, 3)).toEqual({
      scores: [104, 103, 102],
      total: 5,
    })
  })
})

describe('lazy prune (pruneIfDue)', () => {
  it('prunes once per UTC day and is a no-op until the next day', async () => {
    const now = new Date('2026-10-29T12:00:00Z')
    await submit('device-A', 400, 'aaaa', '2026-01-01') // older than 90 days
    await submit('device-A', 400, 'aaaa', DAY)
    expect(await pruneIfDue(db, now)).toBe(1) // ran: one old row gone
    await submit('device-B', 300, 'bbbb', '2026-01-02') // another old row…
    expect(await pruneIfDue(db, now)).toBeNull() // …but today's prune already ran
    expect(await pruneIfDue(db, new Date('2026-10-30T00:00:01Z'))).toBe(1) // next UTC day: runs again
    expect((await topScores(db, 'usa', DAY)).total).toBe(1)
  })
})

describe('streaks + retention', () => {
  it('advances a streak across consecutive days and survives a prune', async () => {
    const who = { board: 'usa', clientId: 'device-A' }
    expect(await updateStreak(db, { ...who, date: '2026-10-28' }, NOW)).toEqual(
      { current: 1, best: 1 },
    )
    expect(await updateStreak(db, { ...who, date: '2026-10-29' }, NOW)).toEqual(
      { current: 2, best: 2 },
    )
    // Same-day replay: no change.
    expect(await updateStreak(db, { ...who, date: '2026-10-29' }, NOW)).toEqual(
      { current: 2, best: 2 },
    )
    await submit('device-A', 400, 'aaaa', '2026-01-01')
    await submit('device-A', 400, 'aaaa', DAY)
    expect(await pruneOldScores(db, '2026-08-01')).toBe(1)
    expect((await topScores(db, 'usa', DAY)).total).toBe(1)
    // The streak table is untouched by the prune.
    expect(await updateStreak(db, { ...who, date: '2026-10-30' }, NOW)).toEqual(
      { current: 3, best: 3 },
    )
  })
})
