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

> **Status:** scaffold. The game engine and UI are landing in the first PRs.
> Sibling project: [KnowYourCity](https://github.com/wardcrazy01894/KnowYourCity)
> (same engine lineage, per-city satellite maps).

## 🚀 Quick start

Requires Node **22.22.2+ (22.x), 24.15+ (24.x), or 26+** (see `engines` in
`package.json`).

```bash
npm install
npm run dev          # → http://localhost:5173/CampusPinShowdown/
```

## 🧰 Development

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

That is exactly what CI gates on. See [`CLAUDE.md`](CLAUDE.md) for the working
agreement (PR-only `main`, TDD, docs-in-the-same-PR).

---

<div align="center"><sub>Idea courtesy of good friend Garret B.</sub></div>
