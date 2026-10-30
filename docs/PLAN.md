# CampusPin Showdown — architecture & mechanics

The engine is a port of [KnowYourCity](https://github.com/wardcrazy01894/KnowYourCity)'s
(same author) with the per-city machinery removed: one region (the lower 48),
one dataset (`public/towns.json`), no backend. This document is the spec the
code is held to; CLAUDE.md's docs map says which section to update when.

## Game loop

Five rounds a day. Each round asks for a **school** (`Where is Texas Tech
University?`); the **town and state are the answer** and appear only after
the guess (`Lubbock, Texas — Home of Texas Tech University`). Towns with
several schools prompt with the first school whose name does not contain the
town (Moorhead → Concordia College), else the first listed (Cambridge →
Harvard), unless the seed pins a `prompt` (Memphis asks "University of
Memphis", not Rhodes College — see `docs/DATA.md`); flagship names that embed
the town ("University of Texas at Austin") are accepted — the location is the
answer, not the name. The player drops a
pin on the night-lights map of the USA and submits. The round header carries
the town's **tier badge** (🟢 Easy / 🟡 Medium / 🔴 Hard, `src/lib/tiers.ts`)
up front — it sets expectations and says nothing about the town, so it is not
a hint; the same badge sits on each results row. On submit the reveal shows the real
pin, a dashed line, the distance in miles, and the round score. After round 5:
total /500, streak, a **day recap map** (`RecapMap`: all five real towns as
numbered green markers, each guess as an amber pin with a dashed line; tap a
results row to zoom to that round) and a Wordle-style share card
(`📍 CampusPin Showdown #N`).
**Hint mode:** the state is withheld by design, but a round offers
"💡 Reveal the region (−25 pts)"; taking it shows the town's **region** — one
of eleven groups of 3–6 neighbouring states (`src/lib/hintRegions.ts`: "the
Great Lakes (OH, MI, IN, IL, WI)"), never the one state, which the owner
judged too strong. It deducts `HINT_PENALTY` (25) from that round on submit
(a hinted perfect pin is 75 — good, never green), persists in
`GameState.hintUsed` so a reload keeps both the hint and the penalty, marks
the round (`RoundResult.hinted`) on the reveal and the results row, and the
share card gains a "💡 N hints" line. The "is my town in the game?" search is offered
only after the day is finished — mid-round it would answer the round.

## Daily selection (`src/lib/daily.ts`)

- **Seed:** `usa:<YYYY-MM-DD>`. The date is the **player's local calendar day**
  (like Wordle) — `getDateKey` builds it from `Intl.DateTimeFormat.formatToParts`
  so no locale short-date quirk can leak in.
- **Ranking:** every town gets a per-day rank `hashStringToSeed(`${seed}|${id}`)`
  (cyrb53); the pool is sorted by rank, ties by id. This is **per town, not a
  shuffle of the whole list**, so adding or removing a town leaves every other
  town's rank untouched and a day's lineup changes only when the new town
  out-ranks a current pick (a guard test pins ≥80 % of days unchanged when one
  town is added). This matters because the dataset grows via "add my town"
  requests while players are mid-game.
- **Plan:** `easy, easy, medium, medium, hard` (`DIFFICULTY_PLAN`). Each slot
  takes the best-ranked town of its difficulty whose **state hasn't appeared
  yet today**; then any of its difficulty; then any town. Accepted subtlety: the
  fresh-state preference can let a lower-ranked town in an unused state win a
  slot, so a new town in a new state changes slightly more days (~1 in 7 on the
  fixture) than one in an existing state.
- **Golden tests** pin the hash, the rank format, and a fixture lineup. Changing
  any of them re-rolls every past and future puzzle — do it deliberately.
- **Puzzle number:** days since `EPOCH_DATE_KEY` (2026-10-29), 1-based, UTC math.

## Scoring (`src/lib/scoring.ts`)

0–100 per round, perfect day = 500. **100 within 25 km**, then an **exponential**
falloff with a 350 km length scale:

| distance | 50 km | 100 km | 200 km | 300 km | 500 km | 800 km | 1000 km | 1500 km |
| -------- | ----- | ------ | ------ | ------ | ------ | ------ | ------- | ------- |
| score    | 93    | 81     | 61     | 46     | 26     | 11     | 6       | 1       |

Right metro = 🟩 (≥80), right state = 🟨/🟧, wrong region = ⬛ (<20). A
**perfect 100** shows the day's special emoji instead of 🟩 — `PERFECT_EMOJIS`
rotates by puzzle number (#1 💯, #2 🏆, #3 〽️, #4 🎯, #5 ⭐, #6 🥇, repeat) so
every share card that day agrees. Distances are shown in **miles**. Haversine on a 6,371 km sphere.

## Map (`src/components/MapGuess.tsx`, `src/lib/tiles.ts`, `src/lib/states.ts`)

Two basemaps, switched with a worded button floating on the map itself
("🌃 Switch to night lights" / "🛰️ Switch to satellite", `BasemapToggle`) and
remembered per device in `localStorage` (`cps:basemap`, `src/lib/basemap.ts`,
default **satellite**) — a display preference, never part of the game save or
the share card. Both `MapGuess` and the results `RecapMap` follow it; switching
swaps the tile layer in place — **the camera never moves** (centre and zoom are
kept, pinned by a render test), so you can zoom in on satellite and flip to the
lights of the same area.

- **night**: **NASA Black Marble** imagery (VIIRS, 2016 composite)
  from NASA GIBS — free, keyless, public domain, served to zoom 8 and upscaled
  to the zoom-10 cap. City lights are the map: metros glow, the dark stays
  dark, nothing is labelled (the maptap.gg look), and the glow is a fair hint.
- **satellite** (default): **EOX Sentinel-2 cloudless** (EOxCloudless, Copernicus
  Sentinel-2 true-colour mosaic, year in `SATELLITE_YEAR`) from EOX's WMTS —
  free, keyless, native to zoom 10. Licence **CC BY-NC-SA 4.0** (this game is
  non-commercial); the credit EOX asks for is the Leaflet attribution on the
  map and is repeated in the footer. A new mosaic year = bump the constant.
  **If the game ever carries ads or a paid tier, this layer must go or be
  re-licensed** (EOX sells a commercial licence); NASA's layer is unaffected.

**State outlines** are a bundled vector layer
(`src/data/us-states.json`: Census 1:20m boundaries, public domain, simplified
to ~1 km, lower 48 + DC, ~120 KB) drawn in their own pane under the markers.
The map is locked to `REGION.bounds` (lower 48 + slack) via `maxBounds` padded
by `MAX_BOUNDS_PAD` (0.05) with min zoom = fit-to-bounds and **max zoom 10**.
Alaska/Hawaii are out of play for now (BACKLOG). (History: CARTO needs a key
now; Esri Light Gray Canvas was the interim basemap.)

## Modes, storage, rollover (`mode.ts`, `storage.ts`, `version.ts`)

- Only the **official daily** writes the real save (`storageId = usa`).
  `?shuffle` → `usa__shuffle` (random 5 per load), `?date=YYYY-MM-DD` →
  `usa__date`. Non-official games can never touch the real streak/history.
- `?reset`/`?fresh` drop **only the current game** (history + streak kept);
  `?shuffle` wipes its scratch namespace entirely (each load is a new lineup).
- A **finished game stays in `current`** so the results screen re-shows on
  reload and the rollover/auto-reload logic can see it.
- **Midnight under an open tab:** the official mode is frozen for the mounted
  session (`resolveSessionMode`); Results shows "Play today's puzzle" (a
  reload). Day-advance is always the player's click.
- **New deploys:** `version.json` (emitted next to the bundle, fetched relative
  to the Vite base) is polled on focus + every 5 min; the tab auto-reloads only
  when that wouldn't disturb a game (`shouldDeferReload`).
- `localStorage` keys are `cps:v1:<storageId>`; bump `STORAGE_VERSION` on any
  shape change — `loadState` treats mismatches and malformed values as empty.
  Additive optional fields don't need a bump: `DayRecord.results[]` gained
  `difficulty` so the results screen can show **lifetime per-tier
  averages** ("Lifetime by tier: 🟢 82 · 🟡 61 · 🔴 34 avg · 12 days",
  `src/lib/stats.ts`); records from before that are skipped, not migrated.

## Anonymous daily leaderboard (`worker/`, `src/lib/leaderboard.ts`)

The game's only backend, and it is optional: a Cloudflare Worker
(`worker/leaderboard.mjs`, config `worker/wrangler.toml`) in front of a D1
table, deployed by hand (`docs/OPERATIONS.md`). Finishing the **official**
daily POSTs `{ board: 'usa', date, score, clientId, lineup }` and the results
screen shows "🏆 You placed 3rd of 47 today" (+ "top X%" once the field is ≥ 20) and a **🏆 View leaderboard** button (top 100 scores, ties share a rank,
your row highlighted). Everything is behind `VITE_LEADERBOARD_ENDPOINT`; unset,
offline or a non-official game → the line and button are simply absent.

- **Anonymous:** identity is a random UUID in `localStorage` (`cps:clientId`);
  the schema reserves a NULL `user_id` for a future login (a lossy migration —
  cleared storage has no id to link).
- **One board** (`usa`), in the primary key so a second region later is
  independent by construction. **Date** is the player's local puzzle day
  (everyone who played "2026-10-29" played the same five towns); the worker
  accepts `[UTC today − 2, UTC today + 1]` and rejects anything else.
- **Lineup-aware:** rows are keyed by `(board, date, client_id, lineup)` so a
  changed-set replay keeps its own row; rank/total/board count each device's
  BEST score once. Keep-max UPSERT makes a reload idempotent; the client caches
  the standing per (date, lineup) so it never re-POSTs, then refreshes rank and
  total from a fresh read (`refreshStanding`) so the line doesn't freeze at
  finish time.
- **Server streak** (`streaks` table, survives the 90-day prune; never
  rewinds on an older-dated submission): returned with the standing. The
  results screen shows the **larger of local and server per field**
  (`mergeStreak`) — the server table is empty on launch day and misses any day
  a submit failed, so "prefer server" would drop a real streak.
- **Retention:** `scores` older than 90 days are pruned **lazily** — on a
  submit, at most once per UTC day (`pruneIfDue`, marker in the `meta` table)
  — because the Cloudflare account is on the Workers Free plan (5 cron
  triggers per account, all taken). The `scheduled` handler is kept for the
  day a cron slot frees up. Streaks are never pruned.
- **Standing line is a link** to the board; the "View leaderboard" button
  remains for players without a standing.
- **Integrity, not anti-cheat:** `official` gates the client; the worker
  validates board, date window, score ∈ [0, 500], id and lineup shapes, origin
  allowlist, body size, and per-IP rate limit (fails closed without one).
  Scores are client-computed, so a determined actor can still POST a fake
  total — accepted for a friends game; Turnstile is the documented next step.

## Bug reports (`worker/bug-report.mjs`, `src/components/BugReport.tsx`)

"🐛 report a bug" opens an **in-app form** (an overlay, like the town search):
type what happened, optionally attach the session log buffer, send, stay on
the site. With `VITE_BUG_ENDPOINT` set the form POSTs
`{ message, context: { date, url, userAgent }, logs, turnstileToken? }` to the
`cps-bug` Worker, which files a GitHub issue (`bug`, `from-app`) with a
fine-grained PAT kept server-side and returns its URL; without the endpoint
the form opens a prefilled GitHub issue page instead. The "is my town in the
game?" miss opens the same form prefilled with "Please add "X" to the game."
Hardening (ported from KnowYourCity): fails closed without a rate limit or
Turnstile; per-IP rate limit (5/min); server-side origin allowlist; body and
field caps; `defang()` neutralises @mentions, code fences, Markdown links and
images, raw HTML and issue cross-references; the reported URL is kept only if
it is from our own origin, embedded parsed + defanged. Anti-spam beyond the
rate limit (Turnstile) is plumbed but off.

## Data (`docs/DATA.md`)

`data/towns-seed.json` (hand-curated: town, state, schools, difficulty) →
`scripts/build-towns.mjs` (Nominatim geocode, cached) → `public/towns.json`.
Details, tiers and the add-a-town recipe live in `docs/DATA.md`.
