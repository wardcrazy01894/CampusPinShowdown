<div align="center">

# 📍 CampusPin Showdown

**A daily "where is that college town?" map-guessing game for the USA.**

[![CI](https://github.com/wardcrazy01894/CampusPinShowdown/actions/workflows/ci.yml/badge.svg)](https://github.com/wardcrazy01894/CampusPinShowdown/actions/workflows/ci.yml)
&nbsp;·&nbsp; React + TypeScript + Vite + Leaflet
&nbsp;·&nbsp; $0 to run

</div>

---

Every day, **everyone gets the same 5 college towns**. You see a town's name and
the school that calls it home (e.g. _Ann Arbor — University of Michigan_), drop
a pin on a map of the United States, and score by how close you got. Share your
result Wordle-style and keep your streak alive.

- 💸 **$0 to run** — free label-free CARTO map tiles, free OpenStreetMap
  geocoding, no backend, no keys.
- 🔁 **No server** — "same 5 for everyone" is computed from the date (a
  per-town hash), so adding a town never re-rolls today's puzzle.
- 🎓 **290 college towns**, hand-curated in three tiers (59 easy · 91 medium ·
  140 hard), lower 48 only for now.
- 📈 **Difficulty ramp** — each day is easy → easy → medium → medium → hard,
  never two towns from the same state.
- 🔊 **Sound feedback** — a triumphant arpeggio for a perfect 100, down to a
  womp-womp for a bad miss (🔊/🔇 to mute).
- 🎉 **Strong-finish celebration** — confetti + a crowd cheer for 4+ greens or
  400+. (Cheer clip: CC0/public-domain, BigSoundBank.)
- 🔎 **"Is my town in the game?"** — search by town, state or school; request a
  missing one with one click.
- 🔥 **Streaks** and a Wordle-style share card with the puzzle number.

> **Status:** playable locally; deploys to GitHub Pages on every merge to
> `main`. Sibling project:
> [KnowYourCity](https://github.com/wardcrazy01894/KnowYourCity) (same engine
> lineage, per-city satellite maps).

## 🎮 How to play

1. A **town name and its school** appear over a map of the USA (the state is
   withheld — that's the game).
2. **Click the map** where you think it is (zoom in for precision — up to
   county scale).
3. **Submit** → the real spot is revealed with your distance (miles) and score.
   100 points within ~15 miles, then an exponential falloff: right metro = 🟩,
   right state = 🟨/🟧, wrong region = ⬛.
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

## 🧰 Development

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

That is exactly what CI gates on. See [`CLAUDE.md`](CLAUDE.md) for the working
agreement (PR-only `main`, TDD, docs-in-the-same-PR).

---

<div align="center"><sub>Idea courtesy of good friend Garret B.</sub></div>
