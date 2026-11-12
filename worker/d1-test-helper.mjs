/**
 * Test-only: a D1-shaped adapter over node:sqlite with the REAL migrations
 * applied, so worker tests pin what the SQL actually does. Not part of the
 * deployed worker (nothing imports it but *.test.mjs).
 */
import { readFileSync, readdirSync } from 'node:fs'
// node:sqlite needs Node >= 22.5 (package.json `engines` enforces this).
import { DatabaseSync } from 'node:sqlite'

function d1(db) {
  const wrap = (sql, args) => ({
    all: () => ({ results: db.prepare(sql).all(...args) }),
    run: () => {
      const info = db.prepare(sql).run(...args)
      return { meta: { changes: Number(info.changes) } }
    },
    first: () => db.prepare(sql).all(...args)[0] ?? null,
  })
  return {
    // Like real D1, an unbound statement can run directly or be bound first.
    prepare: (sql) => ({
      ...wrap(sql, []),
      bind: (...args) => wrap(sql, args),
    }),
    batch: async (stmts) => stmts.map((s) => s.all()),
  }
}

/** A fresh in-memory database with every migration applied, in order. */
export function freshDb() {
  const raw = new DatabaseSync(':memory:')
  const dir = new URL('./migrations/', import.meta.url)
  for (const f of readdirSync(dir).sort()) {
    raw.exec(readFileSync(new URL(f, dir), 'utf8'))
  }
  return d1(raw)
}
