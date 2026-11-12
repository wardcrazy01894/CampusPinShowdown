-- Optional accounts for CampusPin Showdown: a username, a password and a
-- display name. No email, on purpose (so a forgotten password cannot be reset).
--
-- An account's scores and streak live in the SAME `scores` / `streaks` tables
-- as an anonymous device's, under the player key `acct:<id>` in `client_id`.
-- A browser-minted device id can never contain ':' (isValidClientId), so the
-- key cannot be forged, and every existing query (one competitor per
-- client_id, keep-max, the streak row) works for accounts unchanged. The
-- `user_id` columns reserved in 0001/0002 stay unused.

CREATE TABLE IF NOT EXISTS accounts (
  -- AUTOINCREMENT: an id is never reused, so `acct:<id>` rows can never be
  -- inherited by a later account.
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT    NOT NULL UNIQUE,   -- lowercased login
  name       TEXT    NOT NULL,          -- display name, shown on the board
  pass_salt  TEXT    NOT NULL,          -- hex, per account
  pass_hash  TEXT    NOT NULL,          -- hex, PBKDF2 of the client-derived key
  created_at INTEGER NOT NULL           -- epoch ms
);

-- One row per signed-in device. Only the SHA-256 of the bearer token is
-- stored, so a database leak does not hand out sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  account_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL           -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id);

-- The per-round detail behind a score: JSON `[[lat, lng, score, hinted], …]`,
-- one entry per round, always describing the stored `score`. It is what lets
-- a second signed-in device show the finished day (recap map included)
-- instead of offering the puzzle again. NULL for rows written before this.
ALTER TABLE scores ADD COLUMN rounds TEXT;
