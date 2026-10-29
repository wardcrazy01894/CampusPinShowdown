# Backlog

Ideas and follow-ups, roughly prioritized. Done items move to the PR that
shipped them (git history is the changelog).

## Next

- **Custom domain** (likely soon): runbook in `docs/OPERATIONS.md` §Custom domain.
- **Playtest the scoring curve** with real players; constants in
  `src/lib/scoring.ts` (25 km perfect radius, 350 km decay) and the table in
  `docs/PLAN.md` are the thing to tune.
- **Dataset passes:** re-tier anything players flag; more deep-cut D-III and
  NAIA towns; Alcorn State needs a Census-backed pin (no "Lorman" place row).

## Later

- **Alaska / Hawaii (idea, not planned yet — owner 2026-10-29):** the map is
  locked to the lower 48; a second region/board or a wider box with an inset.
- **Leaderboard: invisible Turnstile** on submit if score inflation ever
  appears (the worker already verifies a token when `TURNSTILE_SECRET` is set).
- **One-click bug reports** — port KnowYourCity's bug worker (Turnstile +
  rate-limit) instead of the prefilled-issue link.
- **Town blurbs** on the day recap (a sentence per town, like KnowYourCity's
  blurb sidecar).
- **Downgraded lint rules:** `react-hooks/refs` and `react-hooks/set-state-in-effect`
  are `warn` (inherited patterns in App/MapGuess); fixing them is behaviour
  work and must be test-first.
- **TypeScript 7** once typescript-eslint supports it (Dependabot ignore in
  `.github/dependabot.yml`).
