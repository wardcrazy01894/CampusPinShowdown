<div align="center">

# 📍 CampusPin Showdown

**A daily "where is that college town?" map-guessing game for the USA.**

### ▶ [Play now → wardcrazy01894.github.io/CampusPinShowdown](https://wardcrazy01894.github.io/CampusPinShowdown/)

[![CI](https://github.com/wardcrazy01894/CampusPinShowdown/actions/workflows/ci.yml/badge.svg)](https://github.com/wardcrazy01894/CampusPinShowdown/actions/workflows/ci.yml)
&nbsp;·&nbsp; React + TypeScript + Vite + Leaflet
&nbsp;·&nbsp; $0 to run

</div>

---

Every day, **everyone gets the same 5 college towns**. You're asked where a
school is (_Where is Texas Tech University?_), you drop a pin on a night-lights
map of the United States, and only then do you learn the town (_Lubbock,
Texas_) and how close you got. Share your
result Wordle-style and keep your streak alive.

- 🌃 **Earth at night** — NASA's Black Marble imagery (city lights, no labels)
  with state outlines, like maptap.gg.
- 💸 **$0 to run** — free NASA tiles, free OpenStreetMap geocoding, no keys;
  the only backend is an optional free-tier Cloudflare Worker.
- 🔁 **No server needed to play** — "same 5 for everyone" is computed from the
  date (a per-town hash), so adding a town never re-rolls today's puzzle.
- 🏆 **Anonymous daily leaderboard** — "You placed 3rd of 47 today", a top-100
  board, and a server-side streak; no accounts, no names (`worker/README.md`).
- 🎓 **348 college towns**, hand-curated in three tiers (69 easy · 86 medium ·
  193 hard), lower 48 only for now.
- 📈 **Difficulty ramp** — each day is easy → easy → medium → medium → hard,
  never two towns from the same state.
- 🔊 **Sound feedback** — a triumphant arpeggio for a perfect 100, down to a
  womp-womp for a bad miss (🔊/🔇 to mute).
- 🎉 **Strong-finish celebration** — confetti + a crowd cheer for 4+ greens or
  400+. (Cheer clip: CC0/public-domain, BigSoundBank.)
- 🔎 **"Is my town in the game?"** — after today's puzzle, search by town,
  state or school; request a missing one with one click.
- 🔥 **Streaks** and a Wordle-style share card with the puzzle number.

> **Status:** **live** at <https://wardcrazy01894.github.io/CampusPinShowdown/> —
> auto-deploys on every merge to `main` (runbook:
> [`docs/OPERATIONS.md`](docs/OPERATIONS.md)). Sibling project:
> [KnowYourCity](https://github.com/wardcrazy01894/KnowYourCity) (same engine
> lineage, per-city satellite maps).

## 🎮 How to play

1. A **school name** appears over a night-lights map of the USA — the town
   and state are withheld; that's the game.
2. **Click the map** where you think it is (zoom in for precision — up to
   county scale).
3. **Submit** → the town is revealed (_Lubbock, Texas_) with your distance
   (miles) and score.
   100 points within ~15 miles, then an exponential falloff: right metro = 🟩,
   right state = 🟨/🟧, wrong region = ⬛. A perfect 100 gets the day's special
   emoji (💯, 🏆, 〽️, 🎯, ⭐ or 🥇 — it rotates daily).
4. Five rounds, then a results screen with your total /500, streak, and a
   copyable share.

New puzzle daily at **midnight, your local time** (like Wordle).

## 🚀 Quick start

Requires Node **22.22.2+ (22.x), 24.15+ (24.x), or 26+** (see `engines` in
`package.json`).

```bash
npm install
npm run dev          # → http://localhost:5173/CampusPinShowdown/
```

## 🧪 Local testing

Add a query param to the URL:

| Param              | Effect                                                                        |
| ------------------ | ----------------------------------------------------------------------------- |
| _(none)_           | Today's 5; **progress persists** across refreshes.                            |
| `?reset`           | Same 5, but **drops the current game every refresh** (history + streak kept). |
| `?shuffle`         | A **brand-new random 5 every refresh** — try different sets.                  |
| `?date=YYYY-MM-DD` | Play a specific day's puzzle.                                                 |
| `?celebrate`       | Force the strong-finish confetti/cheer on the results screen.                 |
| `?debug`           | Verbose `[CPS]` logging in the console.                                       |

🐞 **Reporting a bug?** Run **`cpsDumpLogs()`** in the browser console — it
prints the full session log and copies it to your clipboard. Paste that into
the issue.

## 🗃️ Dataset

Towns are curated in [`data/towns-seed.json`](data/towns-seed.json) and
geocoded into `public/towns.json` by `npm run build-towns` (OpenStreetMap
Nominatim, cached, no key). Schema, tiers and the add-a-town recipe:
[`docs/DATA.md`](docs/DATA.md). Mechanics and scoring: [`docs/PLAN.md`](docs/PLAN.md).

## ☁️ Deploy (GitHub Pages)

Every push to `main` builds and publishes via `.github/workflows/deploy.yml`
(test gate → Vite build → Pages). The site is a project page, so
`vite.config.ts` has `base: '/CampusPinShowdown/'`; see
[`docs/OPERATIONS.md`](docs/OPERATIONS.md) for the custom-domain flip, repo
Variables, and the first-run Pages gotcha. The leaderboard worker deploys
separately, by hand: `npm run worker:deploy` (see `worker/README.md`).

## 🧰 Development

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
npm run og-image     # re-render public/og-image.png (share card) after a branding change
```

That is exactly what CI gates on. See [`CLAUDE.md`](CLAUDE.md) for the working
agreement (PR-only `main`, TDD, docs-in-the-same-PR).

---

<div align="center"><sub>Idea courtesy of good friend Garret B.</sub><br /><sub>Built in Ann Arbor spirit — 〽️ Go Blue.</sub></div>
