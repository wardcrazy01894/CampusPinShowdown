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
total /500, streak, a Wordle-style share card (`📍 CampusPin Showdown #N`).
The "is my town in the game?" search is offered only after the day is
finished — mid-round it would answer the round.

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

Right metro = 🟩 (≥80), right state = 🟨/🟧, wrong region = ⬛ (<20). Distances
are shown in **miles**. Haversine on a 6,371 km sphere.

## Map (`src/components/MapGuess.tsx`, `src/lib/tiles.ts`, `src/lib/states.ts`)

**NASA Black Marble** night imagery (VIIRS, 2016 composite) from NASA GIBS —
free, keyless, public domain, served to zoom 8 and upscaled to the zoom-10 cap.
City lights are the map: metros glow, the dark stays dark, nothing is labelled
(the maptap.gg look). **State outlines** are a bundled vector layer
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

## Data (`docs/DATA.md`)

`data/towns-seed.json` (hand-curated: town, state, schools, difficulty) →
`scripts/build-towns.mjs` (Nominatim geocode, cached) → `public/towns.json`.
Details, tiers and the add-a-town recipe live in `docs/DATA.md`.
