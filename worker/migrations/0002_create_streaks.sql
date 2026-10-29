-- Per-player daily streaks for CampusPin Showdown.
--
-- One row per (board, client_id): an anonymous device's consecutive-day streak.
-- Kept in its OWN table (not derived from `scores`) so a long streak survives
-- the 90-day retention prune that deletes old daily score rows.
--
-- The worker advances this on every official submission (updateStreak in
-- leaderboard-lib.mjs): same-day replay = no change, previous day = +1, any
-- gap = reset to 1; `best` is the all-time high. Same `user_id` seam as scores.

CREATE TABLE IF NOT EXISTS streaks (
  board            TEXT    NOT NULL,
  client_id        TEXT    NOT NULL,         -- anonymous device UUID (no PII)
  user_id          TEXT,                     -- reserved for future accounts; NULL now
  current          INTEGER NOT NULL,         -- current consecutive-day streak
  best             INTEGER NOT NULL,         -- all-time best
  last_played_date TEXT    NOT NULL,         -- puzzle day "YYYY-MM-DD" last counted
  updated_at       INTEGER NOT NULL,         -- epoch ms
  PRIMARY KEY (board, client_id)
);
