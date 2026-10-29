# CampusPin Showdown — working agreement

A daily "where is that college town?" map-guessing game for the USA. Sibling of
KnowYourCity (same engine lineage, one nationwide map instead of per-city maps).
See `docs/PLAN.md` for architecture/mechanics and `docs/DATA.md` for the town
dataset. This file is the contract for how changes get made.

## Branch & PR workflow

- **All changes land via a Pull Request — never push directly to `main`.**
- Every PR runs these CI checks (and must be green before merge):
  - **build / typecheck / lint** — `npm ci`, `tsc --noEmit`, `eslint`,
    `prettier --check`, `vite build`.
  - **test** — `vitest run`.
  - **secret scan** — gitleaks over the branch history.
- Branches are **deleted automatically on merge**. Use short-lived feature
  branches: `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- **Squash merge** to keep `main` history linear and readable.

> ✅ **Enforced.** The repo is public and branch protection is active on `main`:
> all three CI checks above are **required** and **strict** (branch must be up to
> date), **conversation resolution is required**, rules **apply to admins**, and
> force-pushes/deletions are blocked. Re-apply or audit with
> `bash scripts/protect-main.sh`.
>
> Required approvals are **0** on purpose: this is a solo repo and GitHub won't
> let you approve your own PR. CI is the gate. Bump it to 1 if a second
> maintainer joins.

Every PR gets an adversarial review before merge (the `adversarial-reviewer`
agent, run in an isolated worktree) — including dependency bumps. Green CI is
necessary, not sufficient.

## How we write code — TDD is mandatory

Every behavior change starts with a failing test (`.claude/skills/tdd-cycle`).
Keep logic in pure, DOM-free functions under `src/lib/` (`*.test.ts`, vitest
Node env); React/Leaflet components stay thin shells with structural render
tests (`*.render.test.tsx`, jsdom). Never mock the unit under test.

## Docs stay current in the same PR

If a change affects documented behavior, update the docs in the **same PR** —
never in a follow-up. The PR template has the checklist.

| Change touches…                                      | Update / verify                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/lib/daily.ts`                                   | PLAN §Daily selection                                                   |
| `src/lib/scoring.ts`                                 | PLAN §Scoring (constants, curve)                                        |
| `src/lib/hintRegions.ts`, hint UI in Game.tsx        | PLAN §Game loop (hint mode)                                             |
| `src/components/MapGuess.tsx`, `src/lib/tiles.ts`    | PLAN §Map                                                               |
| `src/components/RecapMap.tsx`, Results rows          | PLAN §Game loop (day recap)                                             |
| `src/lib/stats.ts`, `DayRecord` shape                | PLAN §Modes, storage (lifetime stats)                                   |
| `src/lib/version.ts`, `src/lib/mode.ts`, App         | PLAN §Rollover + auto-reload                                            |
| `worker/*`, `src/lib/leaderboard.ts`, Leaderboard    | PLAN §Leaderboard + `worker/README.md` + OPERATIONS §Leaderboard worker |
| `worker/bug-report*`, `src/lib/report.ts`, BugReport | PLAN §Bug reports + `worker/README.md` + OPERATIONS §Bug worker         |
| `scripts/build-towns.mjs`, `data/towns-seed.json`    | `docs/DATA.md` (schema, tiers, how to add a town)                       |
| `src/lib/schools.ts` (prompt rule), seed `prompt`    | PLAN §Game loop + DATA §Which school gets asked                         |
| `public/towns.json`                                  | Counts in README + DATA                                                 |
| `.github/workflows/*`, `scripts/protect-main.sh`     | `docs/OPERATIONS.md` + this file's CI-checks list                       |
| `vite.config.ts` (`base`), `index.html` URLs         | `docs/OPERATIONS.md` §Live site / §Custom domain                        |
| `scripts/og-image/*`, `public/og-image.png`          | `docs/OPERATIONS.md` §Share image                                       |
| `.github/dependabot.yml`                             | `docs/OPERATIONS.md` §Dependency updates                                |
| `eslint.config.js`                                   | A comment in the config saying why a rule was changed                   |
| `package.json` scripts / engines                     | README + this file's command list                                       |

## Lint rule policy

Never set a rule to `off` to make an upgrade land. A staged/downgraded rule needs
a comment in `eslint.config.js` saying why, and the fix is a tracked follow-up.
Inline `eslint-disable-next-line` is fine for a one-off and must carry a reason.

## Local commands

```bash
npm install          # first time
npm run dev          # local dev server → http://localhost:5173/
npm run typecheck    # tsc --noEmit (app) + tsconfig.worker.json (worker)
npm run lint         # eslint
npm test             # vitest run (write the test first!)
npm run format       # prettier --write (format:check in CI)
npm run build        # typecheck + vite build (what CI runs)
npm run build-towns  # geocode data/towns-seed.json → public/towns.json
npm run og-image     # re-render public/og-image.png from scripts/og-image/index.html
npm run worker:dev   # leaderboard worker on :8787 against a local D1 (worker/README.md)
npm run worker:migrate:local / worker:migrate / worker:deploy   # D1 schema + worker (by hand, never CI)
npm run bug:dev / bug:deploy   # bug-report worker (needs GH_TOKEN secret; by hand)
```

Run `npm run typecheck && npm run lint && npm run format:check && npm test &&
npm run build` before opening a PR — that's exactly what CI gates on. Don't drop
`format:check`: `build`/`lint` do **not** cover prettier. A PostToolUse hook
auto-formats/lints TS files on edit (`.claude/hooks/lint-on-edit.sh`) but not
other file types — after editing Markdown, JSON or `.mjs`, run `npm run format`.

## Secrets

None in the repo. The client config values (`VITE_CF_BEACON_TOKEN`,
`VITE_LEADERBOARD_ENDPOINT`) are public by design and come from repo Variables
in CI (`.env.local` locally). Nominatim geocoding in `build-towns` needs no
key. Worker secrets — the bug worker's `GH_TOKEN` (fine-grained PAT, Issues
read/write, this repo only) and the optional `TURNSTILE_SECRET` — live in
Cloudflare via `wrangler secret put`, never here (nor in `worker/.dev.vars`,
which is gitignored).

## Git identity

Everything Claude does here is attributed to the `wardcrazy01894` account via the
local Claude Code config (`GIT_AUTHOR_*`/`GIT_COMMITTER_*` env, the
`github-wardcrazy` SSH remote alias, and `GH_CONFIG_DIR`) — no per-command flags.
Don't run `git config --global user.*` or `gh auth switch`.
