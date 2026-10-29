-- Daily leaderboard storage for CampusPin Showdown.
--
-- One row per (board, date, client_id, lineup): an anonymous device's best
-- score for a given puzzle day on a given board. There is ONE board today
-- ('usa'); the column is in the PRIMARY KEY so a future second board (an
-- Alaska/Hawaii region, a per-state board) is independent by construction.
--
-- `date` is the puzzle's calendar day as the PLAYER saw it (local midnight
-- rollover, like Wordle) — everyone who plays "2026-10-29" played the same
-- five towns, whatever their timezone. The worker only checks it is near the
-- server's UTC today (see validateSubmission in leaderboard-lib.mjs).
--
-- `lineup` is a short hash of the day's town ids (client progress.ts:
-- lineupHash). The official set can change under a player mid-day (a town
-- added or re-pinned); they may replay the new set, and that genuine second
-- completion keeps its own row. Rank/total/board are computed over each
-- device's BEST score so one human = one competitor.
--
-- `client_id` is an anonymous random UUID minted in the browser's localStorage
-- (no PII). `user_id` is the reserved seam for FUTURE accounts (NULL today).

CREATE TABLE IF NOT EXISTS scores (
  board      TEXT    NOT NULL,            -- 'usa'
  date       TEXT    NOT NULL,            -- puzzle day, "YYYY-MM-DD"
  client_id  TEXT    NOT NULL,            -- anonymous device UUID (no PII)
  lineup     TEXT    NOT NULL DEFAULT '', -- hash of the played set
  score      INTEGER NOT NULL,            -- daily total, 0..500
  user_id    TEXT,                        -- reserved for future accounts; NULL now
  created_at INTEGER NOT NULL,            -- epoch ms, first submission
  updated_at INTEGER NOT NULL,            -- epoch ms, last (keep-max) update
  PRIMARY KEY (board, date, client_id, lineup)
);

-- Covers the rank count (board, date, score > ?) and the total count
-- (board, date). Leading (board, date) makes per-day scans cheap.
CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (board, date, score);
