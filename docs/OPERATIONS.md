# Operations runbook

How the **live** site is hosted, deployed, and operated. (Architecture is in
[`PLAN.md`](PLAN.md); the dataset in [`DATA.md`](DATA.md).)

## Live site

- **URL:** <https://campuspinshowdown.com/> (the old project-page URL
  <https://wardcrazy01894.github.io/CampusPinShowdown/> redirects there)
- **Host:** GitHub Pages, Source = **GitHub Actions** (`build_type: workflow`),
  served at the custom domain's apex — hence `base: '/'` in
  `vite.config.ts`. Every runtime fetch (`towns.json`, `version.json`) is
  base-relative, so the asset/fetch side of a custom-domain move is a one-line
  `base` change (the full checklist is below).
- **First-run gotcha (2026-10-29):** `actions/configure-pages` with
  `enablement: true` could **not** create the Pages site on this repo —
  `Create Pages site failed: Resource not accessible by integration` (the
  workflow `GITHUB_TOKEN` lacks the admin scope the create call needs here,
  unlike KnowYourCity where it worked). Fixed once by enabling Pages via the
  API as the owner, then re-running the failed job:

  ```bash
  gh api -X POST repos/wardcrazy01894/CampusPinShowdown/pages -f build_type=workflow
  gh run rerun <run-id> --failed
  ```

  Pages stays enabled after that; the `enablement: true` is harmless on later
  runs (it finds the existing site).

## Share image (Open Graph)

`public/og-image.png` (1200×630) is what Slack/iMessage/X unfurl. Its source is
`scripts/og-image/index.html`; after a branding change run `npm run og-image`
(headless Chrome screenshot, `scripts/og-image.mjs`; `CHROME=` overrides the
binary) and commit the PNG. The `og:image`/`twitter:image` URLs in `index.html`
are absolute — update them with the custom domain (checklist below).

## Deploy

- **Automatic:** every push to `main` runs `.github/workflows/deploy.yml`
  (test/lint/format gate → `npm run build` → upload Pages artifact → deploy).
  A couple of minutes; the live URL updates when the `deploy` run goes green.
- **Manual re-run:** Actions tab → **deploy** → **Run workflow**
  (`workflow_dispatch`). Needed after changing a repo Variable — Variables
  only take effect on the **next build**.
- **Rollback:** revert the offending PR on `main` (auto-redeploys), or
  Settings → Pages → **Unpublish site** to pull it entirely.
- `deploy.yml` is **not** a required status check, so a failed deploy never
  blocks merges; it just means the last publish didn't happen. Check Actions.
- **Stale tabs:** the client polls `version.json` (emitted next to the bundle)
  on focus and every 5 min and reloads itself when the hash changes — unless
  the player is mid-round or parked on a past day's results (see
  `src/lib/version.ts`). No service worker, so a reload is all it takes.

## Custom domain — `campuspinshowdown.com` (Cloudflare Registrar)

Registered at **Cloudflare Registrar** (at-cost .com, auto-renew ON). DNS is
the Cloudflare zone for the domain, **DNS-only (grey cloud), not proxied**, so
GitHub can issue and renew the Pages certificate:

| Type  | Name  | Content                                                                    |
| ----- | ----- | -------------------------------------------------------------------------- |
| A     | `@`   | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |
| CNAME | `www` | `wardcrazy01894.github.io`                                                 |

Repo side: `public/CNAME` = `campuspinshowdown.com` (ships in every artifact),
GitHub Settings → Pages → Custom domain = the apex with **Enforce HTTPS** on,
`base: '/'` in `vite.config.ts`, absolute URLs in `index.html` (canonical,
`og:url`, `og:image`, `twitter:image`, JSON-LD) and README, the dev URL in
`CLAUDE.md`, and the new origins in the worker's `ALLOWED_ORIGIN` (then
`npm run worker:deploy`). `REPO_URL` in `src/lib/report.ts` is the GitHub repo
and did not change. Known consequence: `localStorage` (streaks/history) does
not carry across origins — players who used the github.io URL start fresh.

To move again: repeat the list above for the new name, keep the old origin in
`ALLOWED_ORIGIN` for a while, and set the old domain to redirect.

## Client configuration — repo **Variables**

The site is a static bundle, so all its config is **public** (ships in the JS)
and is injected at build time from repo **Variables** (Settings → Secrets and
variables → Actions → **Variables**), never Secrets:

| Variable                    | Current value                    | Purpose                                                                               |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| `VITE_CF_BEACON_TOKEN`      | _(unset)_                        | Cloudflare Web Analytics beacon — cookieless page views                               |
| `VITE_LEADERBOARD_ENDPOINT` | the `cps-leaderboard` worker URL | anonymous daily leaderboard + server streak; **unset → the leaderboard UI is hidden** |

Nothing else. Map tiles (NASA GIBS) and geocoding (Nominatim, build-time only)
need no key.

## Leaderboard worker (`cps-leaderboard`)

The game's only backend, and it is optional. A Cloudflare Worker
(`worker/leaderboard.mjs`, config `worker/wrangler.toml`) with its own D1
database (`cps-leaderboard`) stores anonymous keep-max daily scores and
per-player streaks; the full design is in `docs/PLAN.md` §Leaderboard and the
request shapes in `worker/README.md`. Its own worker, database and rate-limit
namespace — nothing is shared with KnowYourCity's `kyc-leaderboard`.

> ⚠️ **Unlike the web app, the worker does NOT auto-deploy.** `deploy.yml`
> only ships the static site. Worker code **and D1 migrations** are applied by
> hand with Wrangler (logged in to the Cloudflare account) — a change merged to
> `main` is **not** live until you run the commands below. There is no CI
> signal if you forget.

```bash
npm run worker:migrate   # apply worker/migrations/*.sql to the REMOTE D1 (idempotent)
npm run worker:deploy    # wrangler deploy -c worker/wrangler.toml
```

First-time setup (`wrangler d1 create cps-leaderboard` → paste the
`database_id` into the toml → migrate → deploy → set the Variable above → re-run
the deploy workflow) is in `worker/README.md`. `TURNSTILE_SECRET` is optional and
should stay unset until the client has an invisible Turnstile execute.

**Runbook:** a 503 from the worker on every submit = D1 outage or a missing
migration — `wrangler tail -c worker/wrangler.toml` shows the logged
`leaderboard submit failed` / `streak update failed` lines. A 403 on the live
site = `ALLOWED_ORIGIN` in the toml doesn't include the site origin (update it
when the custom domain lands, then `npm run worker:deploy`). Inspect rows with
`wrangler d1 execute cps-leaderboard --remote -c worker/wrangler.toml --command "SELECT date, COUNT(*) FROM scores GROUP BY date"`.

## Repo protection

`main` is PR-only: required checks `build / typecheck / lint`, `test`,
`secret scan`; strict (branch up to date); conversation resolution required;
rules apply to admins; no force-push/deletion; squash merge is the convention
(merge-commit and rebase merging are technically still enabled); delete branch
on merge. Re-apply or audit with `bash scripts/protect-main.sh`. Dependabot alerts
and automated security fixes are enabled.

## Dependency updates

Dependabot (`.github/dependabot.yml`) opens **one grouped PR per ecosystem
per week** for minor+patch bumps (npm, GitHub Actions) and **one PR per major**.
Every Dependabot PR runs the same required checks and gets the same adversarial
review as any other change — green CI is necessary, not sufficient. Watch for
0.x packages riding the grouped PR (semver-minor there can be breaking).
TypeScript majors are ignored until typescript-eslint supports TS 7.

## Monitoring & bug reports

- The site has no backend; the optional leaderboard worker is best-effort
  (every failure path hides the line, never breaks the game). The Actions tab
  shows deploy health; `wrangler tail` shows the worker's logs.
- Players report bugs via the in-app **🐛 report a bug** link → a prefilled
  GitHub issue (title, puzzle date, URL, browser). Ask them for
  `cpsDumpLogs()` output (browser console) when the report is thin.
- Town/pin corrections: edit `data/towns-seed.json`, `npm run build-towns`,
  PR. Per-town ranking means a fix only changes the days that town was picked.
