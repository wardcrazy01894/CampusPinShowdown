<div align="center">

# 📍 CampusPin Showdown

**A daily "where is that college town?" map-guessing game for the USA.**

### ▶ [Play now → campuspinshowdown.com](https://campuspinshowdown.com/)

[![CI](https://github.com/wardcrazy01894/CampusPinShowdown/actions/workflows/ci.yml/badge.svg)](https://github.com/wardcrazy01894/CampusPinShowdown/actions/workflows/ci.yml)
[![deploy](https://github.com/wardcrazy01894/CampusPinShowdown/actions/workflows/deploy.yml/badge.svg)](https://github.com/wardcrazy01894/CampusPinShowdown/actions/workflows/deploy.yml)

React · TypeScript · Vite · Leaflet &nbsp;·&nbsp; 349 towns &nbsp;·&nbsp; $0 hosting

</div>

---

Every day, **everyone gets the same 5 college towns**. You're asked where a
school is (_Where is Texas Tech University?_), you drop a pin on a night-lights
map of the United States, and only then do you learn the town (_Lubbock,
Texas_) and how close you got. Share your result Wordle-style and keep your
streak alive.

## ✨ Features

|     |                                  |                                                                                                                                               |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 🌃  | **Earth at night, or satellite** | NASA's Black Marble imagery (city lights, no labels) with state outlines — the glow _is_ the hint. Tap 🌃/🛰️ for a Sentinel-2 satellite view. |
| 🎓  | **349 college towns**            | Hand-curated in three tiers (69 easy · 86 medium · 194 hard), lower 48 only for now. Flagships, HBCUs, service academies, D-III.              |
| 📈  | **Difficulty ramp**              | Each day is easy → easy → medium → medium → hard, never two towns from the same state.                                                        |
| 💡  | **Hint mode**                    | Buy the region (3–6 neighbouring states) for −25 points on that round; hints show on the share card.                                          |
| 🏆  | **Anonymous daily leaderboard**  | "You placed 3rd of 47 today", a top-100 board and a server-side streak. No accounts, no names.                                                |
| 🔥  | **Streaks & lifetime stats**     | Per-tier averages, a Wordle-style share card with the puzzle number, and a day recap map.                                                     |
| 🔊  | **Sound & celebration**          | A triumphant arpeggio for a perfect 100 down to a womp-womp for a miss; confetti + a crowd cheer for a strong day. 🔊/🔇 to mute.             |
| 🐛  | **In-app bug reports**           | Type what went wrong and send; it lands as a GitHub issue without leaving the site.                                                           |
| 🔎  | **"Is my town in the game?"**    | After today's puzzle, search by town, state or school; request a missing one with one click.                                                  |
| 🔁  | **No server needed to play**     | "Same 5 for everyone" is computed from the date (a per-town hash), so adding a town never re-rolls today's puzzle.                            |
| 💸  | **$0 hosting**                   | Free NASA tiles, free OpenStreetMap geocoding, no API keys; the only backend is two free-tier Cloudflare Workers.                             |

> **Status:** **live** at <https://campuspinshowdown.com/> — auto-deploys on
> every merge to `main` (runbook: [`docs/OPERATIONS.md`](docs/OPERATIONS.md)).
> Sibling project: [KnowYourCity](https://github.com/wardcrazy01894/KnowYourCity)
> (same engine lineage, per-city satellite maps).

## 🎮 How to play

1. A **school name** appears over a night-lights map of the USA (or a
   satellite view — 🌃/🛰️ in the header) — the town and state are withheld;
   that's the game.
2. **Tap the map** where you think it is (zoom in for precision — up to
   county scale). Stuck? **💡 Reveal the region** (a few neighbouring
   states) for −25 points on that round; the share card notes how many hints
   you took.
3. **Submit** → the town is revealed (_Lubbock, Texas_) with your distance
   (miles) and score. 100 points within ~15 miles, then an exponential
   falloff: right metro = 🟩, right state = 🟨/🟧, wrong region = ⬛. A
   perfect 100 gets the day's special emoji (💯, 🏆, 〽️, 🎯, ⭐ or 🥇 — it
   rotates daily).
4. Five rounds, then a results screen with your total /500, streak, lifetime
   averages, a recap map and a copyable share.

New puzzle daily at **midnight, your local time** (like Wordle).

## 🚀 Quick start

Requires Node **22.22.2+ (22.x), 24.15+ (24.x), or 26+** (see `engines` in
`package.json`).

```bash
npm install
npm run dev          # → http://localhost:5173/
```

The leaderboard and bug-report lines are hidden locally unless you point
`.env.local` at a worker (see [`.env.example`](.env.example)); the game itself
needs nothing.

### 🧪 Local testing

Add a query param to the URL:

| Param              | Effect                                                                        |
| ------------------ | ----------------------------------------------------------------------------- |
| _(none)_           | Today's 5; **progress persists** across refreshes.                            |
| `?reset`           | Same 5, but **drops the current game every refresh** (history + streak kept). |
| `?shuffle`         | A **brand-new random 5 every refresh** — try different sets.                  |
| `?date=YYYY-MM-DD` | Play a specific day's puzzle.                                                 |
| `?celebrate`       | Force the strong-finish confetti/cheer on the results screen.                 |
| `?debug`           | Verbose `[CPS]` logging in the console.                                       |

🐞 **Reporting a bug?** Use the in-app **🐛 report a bug** form (it attaches
the session log for you), or run **`cpsDumpLogs()`** in the browser console
to print the full log and copy it to your clipboard.

## 🧰 Development

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

That is exactly what CI gates on. Everything lands via a PR; `main` is
protected. See [`CLAUDE.md`](CLAUDE.md) for the working agreement (PR-only
`main`, TDD, docs-in-the-same-PR, adversarial review before merge).

| Command                                                   | What it does                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`                                             | Vite dev server with hot reload                                                  |
| `npm test`                                                | Vitest (pure logic in Node, components in jsdom)                                 |
| `npm run typecheck` / `lint` / `format` / `format:check`  | tsc (app + worker), eslint, prettier                                             |
| `npm run build`                                           | Typecheck + production bundle in `dist/`                                         |
| `npm run build-towns`                                     | Geocode `data/towns-seed.json` → `public/towns.json` (Nominatim, cached, no key) |
| `npm run og-image`                                        | Re-render `public/og-image.png` (the share-unfurl image) after a branding change |
| `npm run worker:dev` / `worker:migrate` / `worker:deploy` | Leaderboard worker + its D1 database ([`worker/README.md`](worker/README.md))    |
| `npm run bug:dev` / `bug:deploy`                          | Bug-report worker (needs a `GH_TOKEN` secret in Cloudflare)                      |

### 🗂️ Repo map

```
src/lib/          pure game logic (daily selection, scoring, hints, stats, storage…) + tests
src/components/   thin React/Leaflet shells (Game, MapGuess, Results, RecapMap, Leaderboard…)
data/             towns-seed.json (curated) · census-pins.json (independent cross-check)
public/           towns.json (generated) · og-image.png · CNAME
scripts/          build-towns · build-census-pins · og-image
worker/           cps-leaderboard + cps-bug Cloudflare Workers, D1 migrations
docs/             PLAN (mechanics) · DATA (dataset) · OPERATIONS (hosting runbook)
```

## 🗃️ Dataset

Towns are curated in [`data/towns-seed.json`](data/towns-seed.json) and
geocoded into `public/towns.json` by `npm run build-towns` (OpenStreetMap
Nominatim, cached, no key). Every pin is cross-checked against the US Census
Gazetteer, in the build and again in CI, so a mis-geocoded town can't ship.
Schema, tiers and the add-a-town recipe: [`docs/DATA.md`](docs/DATA.md).
Mechanics and scoring: [`docs/PLAN.md`](docs/PLAN.md).

## ☁️ Hosting & deploy

- **Site:** GitHub Pages at the custom domain `campuspinshowdown.com`
  (`public/CNAME`, `base: '/'`). Every push to `main` builds and publishes via
  `.github/workflows/deploy.yml` (test gate → Vite build → Pages).
- **Backend:** two optional Cloudflare Workers on the free plan — the
  leaderboard (`cps-leaderboard`, with a D1 database) and the bug reporter
  (`cps-bug`). They deploy **by hand**, never from CI: `npm run worker:deploy`,
  `npm run bug:deploy`.
- **Cost:** the domain registration is the only bill. Pages, Actions, Workers,
  D1, NASA GIBS tiles and Nominatim geocoding are all free tiers or public
  services.

Runbook, custom-domain notes, repo Variables and the first-run Pages gotcha:
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## 🙏 Credits

- Night imagery: [NASA GIBS](https://earthdata.nasa.gov/gibs) · VIIRS Black
  Marble (public domain).
- Satellite imagery: [EOxCloudless](https://cloudless.eox.at) by EOX IT
  Services GmbH, contains modified Copernicus Sentinel data (CC BY-NC-SA 4.0).
- Town coordinates: © OpenStreetMap contributors (ODbL), via Nominatim.
- State outlines and Census pins: US Census Bureau (public domain).
- Cheer clip: CC0 / public domain, BigSoundBank.

---

<div align="center"><sub>Idea courtesy of good friend Garret B.</sub><br /><sub>Built in Ann Arbor spirit — 〽️ Go Blue.</sub></div>
