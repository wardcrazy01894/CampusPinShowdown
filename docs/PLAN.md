# CampusPin Showdown — architecture & mechanics

The engine is a port of [KnowYourCity](https://github.com/wardcrazy01894/KnowYourCity)'s
(same author) with the per-city machinery removed: one region (the lower 48),
one dataset (`public/towns.json`), and an optional backend (leaderboard +
accounts) the game never depends on. This document is the spec the
code is held to; CLAUDE.md's docs map says which section to update when.

## Game loop

Five rounds a day. Each round asks for a **school** (`Where is the University of
Michigan?`); the **town and state are the answer** and appear only after
the guess (`Ann Arbor, Michigan — Home of the University of Michigan`). Towns with
several schools prompt with the first school whose name does not contain the
town (Moorhead → Concordia College), else the first listed (Cambridge →
Harvard), unless the seed pins a `prompt` (Memphis asks "University of
Memphis", not Rhodes College — see `docs/DATA.md`); flagship names that embed
the town ("University of Texas at Austin") are accepted — the location is the
answer, not the name. The player drops a
pin on the satellite map of the USA (or the night-lights map, one tap away)
and submits. The round header carries
the town's **tier badge** (🟢 Easy / 🟡 Medium / 🔴 Hard, `src/lib/tiers.ts`)
up front — it sets expectations and says nothing about the town, so it is not
a hint; the same badge sits on each results row. On submit the reveal shows the real
pin, a dashed line, the distance in miles, and the round score — and, under
the "Home of …" line, the **school card** (`SchoolCard`): a hand-written fun
fact, then whichever of these the data has — public/private + founding year,
undergrad/grad enrollment (with its term), team nickname · conference ·
division (D-I FBS, D-III, NAIA…), mascot, U.S. News rank on its list — then
up to five notable alumni and a Wikipedia credit link. The card is keyed by
the round's prompt school and read from `public/schools.json`
(`src/lib/schoolFacts.ts`; built by `scripts/build-schools.mjs`, see
`docs/DATA.md` §School facts), fetched lazily on the first reveal and never
before: the fact names the town. A missing row or a failed fetch renders
nothing — the game never waits on it. After round 5:
total /500, streak, a **day recap map** (`RecapMap`: all five real towns as
numbered green markers, each guess as an amber pin with a dashed line; tap a
results row to zoom to that round), an "ℹ️ About <school>" toggle under each
row that opens the same school card (one open at a time; it never moves the
map), and a Wordle-style share card (`📍 CampusPin Showdown #N`).
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

**The map is the screen (every width).** Player feedback (2026-11-04) was
that the map was too small and hard to move around: on a phone it was the
viewport minus ~390px of header, prompt and button, ~270px for the lower 48.
Now, while a round is open, `<main>` carries `is-playing` and is a
viewport-tall column: the header, then `section.play` taking all the rest;
the map fills `.play`, and the prompt (`.play__prompt`: round, tier, score,
question, hint) and the action bar (`.play__actions`: Submit, or distance +
Next after the reveal) float over its top and bottom edges as translucent
cards (max 640px wide, centred on wide screens). The footer is hidden during
play (the imagery credits stay on the map's attribution control) and returns
on the results screen. Leaflet's +/− control and the basemap button sit
bottom-left / bottom-right above the attribution. On phones (≤600px) the
header additionally slims to the brand line (tagline, mode chip and links
hidden; a 🐛 icon button next to the mute button keeps the bug report
reachable) and the +/− control is hidden (pinch zooms). Because the cards
cover part of the map, the reveal fit is padded by how far they reach into it
(`coverInsets` in `src/lib/mapBounds.ts`, measured from the DOM at fit time
via `MapGuess.viewInsets`), so both pins land in the visible band — except
when the fit is already at min zoom (guess and truth far apart), where a pin
can sit under a card; accepted, the cards are translucent and the map pans.
All of this is CSS in `src/index.css` over a DOM shape pinned by
`Game.render.test.tsx`.

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
- **Recency cooldown (from 2026-11-10):** a town that appeared in any of the
  previous **14** daily lineups is not eligible (`COOLDOWN_DAYS`,
  `dailyLineup`). Independent per-day draws repeated towns fast — five
  repeats in the first eleven days, Norman two days running, birthday math
  on a 69-town easy tier. `dailyLineup` walks the days in order from 14 days
  before the switch-on date (those use the legacy selection and seed the
  history), excluding the last 14 lineups' towns, so it stays a pure function
  of (dataset, date) with no storage, and puzzles #1–#12 keep the lineups
  people played. Excluded towns return only as a last resort when a tier is
  exhausted (tiny datasets). The walk is memoised per dataset array; three
  years cost ~150 ms. `?shuffle` has no history and skips it (`Mode.cooldown`),
  and a `?date=` more than a year ahead is ignored so a hand-typed 2099
  cannot freeze the page walking 26k days (`DATE_OVERRIDE_HORIZON_DAYS`).
  **Trade-off, measured over 730 simulated days:** the stability property
  above weakens slightly — with the cooldown a dataset change can ripple into
  the following days' lineups. At 14 days, adding a town changed _today's_
  lineup in 2 of 30 trials (1 of 30 without) and ~1.4 of the next 30 days
  (0.7 without); at 21 days it was 10 of 30, at 28 days 16 of 30, which is
  why the window is two weeks. Excluding the previous days' _raw_ (no-cooldown)
  picks instead would keep full stability but barely helps (813 repeats in
  two years at 21 days vs 0).
- **Golden tests** pin the hash, the rank format, and a fixture lineup. Changing
  any of them re-rolls every past and future puzzle — do it deliberately.
  `src/lib/towns.test.ts` additionally walks three years of real lineups and
  asserts no town returns within 14 days, every day full and state-diverse.
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
Only the **widest view** is locked (`lockMapToBounds`, `src/lib/lockBounds.ts`,
shared with the recap map): min zoom = the fit of `REGION.bounds` (re-locked
on resize), **max zoom 10**, and Leaflet's `bounceAtZoomLimits` off so a pinch
past min zoom stops there instead of overshooting and springing back. There is
**no `maxBounds`** — the owner's call after two rounds of phone feedback: the
map must never move by itself. Every bounds scheme did (#24: a viscous edge
overshot and sprang back; #25: a box smaller than the portrait viewport slid
and recentred, and a box re-fitted per zoom panned the view back inside after
each zoom). The player can drag the country off the screen and drags it back.
The floating cards carry no `backdrop-filter`: blurring moving tiles on every
frame of a pan is a real GPU cost on phones. Alaska/Hawaii are out of play
for now (BACKLOG). (History: CARTO needs a key now; Esri Light Gray Canvas
was the interim basemap.)

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
- A signed-in account can rewrite the official save from the server (streak,
  and today's game when it was finished on another device) — see §Accounts.
  The sign-in itself is `cps:account` (token, username, display name).
- `localStorage` keys are `cps:v1:<storageId>`; bump `STORAGE_VERSION` on any
  shape change — `loadState` treats mismatches and malformed values as empty.
  Additive optional fields don't need a bump: `DayRecord.results[]` gained
  `difficulty` so the results screen can show **lifetime per-tier
  averages** ("Lifetime by tier: 🟢 82 · 🟡 61 · 🔴 34 avg · 12 days",
  `src/lib/stats.ts`); records from before that are skipped, not migrated.

## Daily leaderboard (`worker/`, `src/lib/leaderboard.ts`)

The game's only backend, and it is optional: a Cloudflare Worker
(`worker/leaderboard.mjs`, config `worker/wrangler.toml`) in front of a D1
table, deployed by hand (`docs/OPERATIONS.md`). Finishing the **official**
daily POSTs `{ board: 'usa', date, score, clientId, lineup }` and the results
screen shows "🏆 You placed 3rd of 47 today" (+ "top X%" once the field is ≥ 20) and a **🏆 View leaderboard** button (top 100 scores, ties share a rank,
your row highlighted). Everything is behind `VITE_LEADERBOARD_ENDPOINT`; unset,
offline or a non-official game → the line and button are simply absent.

- **Anonymous by default:** identity is a random UUID in `localStorage`
  (`cps:clientId`). A signed-in player (§Accounts below) is identified by
  their account instead, and their row on the board carries their **display
  name**; anonymous rows show rank and score only. The read returns
  `{ total, scores[], names[] }` (`names` parallel to `scores`, `''` for an
  anonymous row) — never ids, usernames or tokens.
- **One board** (`usa`), in the primary key so a second region later is
  independent by construction. **Date** is the player's local puzzle day
  (everyone who played "2026-10-29" played the same five towns); the worker
  accepts `[UTC today − 2, UTC today + 1]` and rejects anything else.
- **Lineup-aware:** rows are keyed by `(board, date, client_id, lineup)` so a
  changed-set replay keeps its own row; rank/total/board count each player's
  BEST score once (`client_id` is the player key: a device id, or `acct:<id>`
  for an account). Keep-max UPSERT makes a reload idempotent; the client caches
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

## Accounts + cross-device sync (`worker/accounts-lib.mjs`, `src/lib/account.ts`, `src/lib/sync.ts`, `AccountDialog`)

Optional, and ported from WhereHePlay. An account is a **username, a password
and a display name — no email** (so a forgotten password cannot be reset; the
dialog says so). It lives in the leaderboard worker, so it is offered only
when `VITE_LEADERBOARD_ENDPOINT` is set: a "👤 sign in / create account" link
in the header (a 👤 icon on the slim phone header during play), and a "keep
it on all your devices" link next to the streak on the results screen. The
sign-up form states that the username is **not an email**, and both the form
(`usernameProblem`) and the worker (`validateUsername`) refuse anything with
an `@`.

- **What signing in changes.** The device keeps a session token
  (`cps:account` in `localStorage`); its daily score is submitted with it and
  becomes the **account's** — one row on the board across all its devices,
  under the display name (2–20 Latin letters, digits, space, `_ . - '`; a
  short blocklist; changeable any time).
- **Storage model.** No new score tables: an account's rows are ordinary
  `scores`/`streaks` rows whose `client_id` is `acct:<id>`. A device id cannot
  contain `:`, so the key cannot be forged and every leaderboard query treats
  an account as one competitor unchanged. `accounts` holds username, name and
  the password hash; `sessions` holds the SHA-256 of each token (newest 10 per
  account). `scores.rounds` holds each round's `[lat, lng, score, hinted]`
  for the stored score — the detail another device needs to show the day.
- **Inheriting a streak (the owner's rule).** People had streaks before
  accounts existed, and the server's own streak table missed part of them
  (every day before the leaderboard was on, every failed submit). So on
  register/sign-in the server folds in the device's anonymous rows
  (`foldIntoAccount`: scores move to the account, better score wins a clash,
  the anonymous twin disappears from the board), and on every sync the device
  **vouches for its local streak** (`streakClaim` → `/me`), which the server
  merges into the account's (`mergeStreaks`): the later last-played day
  decides, **the same day → the longer streak**, consecutive days → the run
  continues (earlier count + 1 at least), and a streak that had already
  lapsed does not come back (its `best` does). A computer on 12 and a phone on
  5 become 12 on both. The claim is unverifiable, like the scores — it is
  only bounded (`validateStreakClaim`: a real day inside the submission
  window, not before puzzle #1, not longer than the game has existed).
- **Sync (`syncProgress`, signed in, official daily only).** On load, on
  sign-in and whenever the tab becomes visible, the app POSTs `/me` and
  applies `planSync` to the save: the streak becomes the merged one; a daily
  **finished on another device replaces today's game here** — also one only
  in progress — and the results screen shows it (score, recap map, rows)
  rebuilt from `rounds` (`gameFromDay`; the row must be for this day and this
  lineup and add up, else it is ignored); a day finished **here** that the
  account lacks is handed over once per page load. A day this device finished
  is never swapped out. App remounts the Game when the game was replaced
  (`gameEpoch`) and has it re-read the streak otherwise (`syncEpoch`), so a
  pin being placed is never disturbed by a streak-only update. Not synced: a
  game in progress, the lifetime per-tier history, display preferences.
- **Signing out** (`resetForSignOut`) returns the device to a fresh anonymous
  player: the streak and today's game are dropped locally (they are the
  account's and return on the next sign-in — otherwise the next person to sign
  in on a shared device would inherit them through the claim); the history
  stays. A session the **server** ended (`/me` → 401) only clears the token.
- **Passwords** use a split KDF: the browser stretches the password
  (PBKDF2-SHA256, 150k iterations, salted with the username) and sends only
  that key; the worker stretches it again (1,000 iterations, random
  per-account salt) and stores that. The plaintext never leaves the device.
  Login answers one error for every failure, burns the same hashing for an
  unknown username, and sits with register behind a 5/min limiter
  (`LOGIN_LIMITER`: per IP + username for login, per IP for register) that
  **fails closed** when unbound.
- **Worker and site ship separately.** The site deploys on merge, the worker
  by hand, so each tolerates the other's older version: an old worker answers
  account routes with `unknown board` (the dialog says accounts aren't on
  yet; sync does nothing), and a page cached from before accounts still reads
  the board (`scores` kept its shape).
- **Trust model:** unchanged — scores and streaks are client-computed, so
  anti-cheat stays a non-goal. The controls stop accidents, drive-by abuse
  and account takeover. Known, accepted: two accounts cannot be merged; a
  device whose session the server ended keeps its local streak, so whoever
  signs in next on it inherits it.

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
