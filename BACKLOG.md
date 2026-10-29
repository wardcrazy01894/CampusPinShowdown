# Backlog

Ideas and follow-ups, roughly prioritized. Done items move to the PR that
shipped them (git history is the changelog).

## Next

- **Custom domain** (likely soon): runbook in `docs/OPERATIONS.md` §Custom domain.
- **Playtest the scoring curve** with real players; constants in
  `src/lib/scoring.ts` (25 km perfect radius, 350 km decay) and the table in
  `docs/PLAN.md` are the thing to tune.
- **Dataset passes:** more deep-cut towns (HBCUs, service academies beyond
  Annapolis/West Point/USAFA, more D-III towns); re-tier anything players flag.

## Later

- **Hint mode:** reveal the state for a point penalty (the state is withheld by
  design today).
- **Alaska / Hawaii:** the map is locked to the lower 48; a second region or a
  wider box with an inset.
- **Anonymous daily leaderboard** — port KnowYourCity's Cloudflare Worker + D1
  (the `lineupHash` charset is already leaderboard-safe).
- **One-click bug reports** — port KnowYourCity's bug worker (Turnstile +
  rate-limit) instead of the prefilled-issue link.
- **Day recap** after results: all five pins on one map with a blurb per town.
- **Per-tier stats line** on results (lifetime average per 🟢/🟡/🔴).
- **Downgraded lint rules:** `react-hooks/refs` and `react-hooks/set-state-in-effect`
  are `warn` (inherited patterns in App/MapGuess); fixing them is behaviour
  work and must be test-first.
- **TypeScript 7** once typescript-eslint supports it (Dependabot ignore in
  `.github/dependabot.yml`).
