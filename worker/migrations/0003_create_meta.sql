-- Tiny key/value table for worker bookkeeping. First use: `last_prune`, the
-- date (YYYY-MM-DD) the retention prune last ran, so the prune can run LAZILY
-- from a request at most once per UTC day. Why: the Cloudflare account is on
-- the Workers Free plan, which allows 5 cron triggers per account, and those
-- slots were already taken when this worker deployed — the `scheduled`
-- handler stays in place for the day a slot frees up, but the game must not
-- depend on it.

CREATE TABLE IF NOT EXISTS meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL           -- epoch ms
);
