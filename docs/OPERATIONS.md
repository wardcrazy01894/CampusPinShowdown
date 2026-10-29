# Operations runbook

How the **live** site is hosted, deployed, and operated. (Architecture is in
[`PLAN.md`](PLAN.md); the dataset in [`DATA.md`](DATA.md).)

## Live site

- **URL:** <https://wardcrazy01894.github.io/CampusPinShowdown/>
- **Host:** GitHub Pages, Source = **GitHub Actions** (`build_type: workflow`),
  served as a **project page** — hence `base: '/CampusPinShowdown/'` in
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

## Custom domain (when the time comes)

1. Register the domain; point an **ALIAS/ANAME** on the apex (and a `CNAME`
   for `www`) at `wardcrazy01894.github.io` — or, for a DNS host without
   ALIAS, the four GitHub Pages apex `A` records (185.199.108–111.153).
2. Settings → Pages → Custom domain = the apex; tick **Enforce HTTPS** once the
   certificate is issued. Add `public/CNAME` with the domain so the file ships
   in every artifact.
3. Flip `base` in `vite.config.ts` to `'/'`, then replace **every** `github.io`
   URL: `index.html` (canonical, `og:url`, `og:image`, `twitter:image` and the JSON-LD
   `"url"`), the
   README play-now + status links, the dev URL in `CLAUDE.md`, and the
   hardcoded share URL in `src/lib/share.test.ts` (it still passes, but keep
   it honest). `REPO_URL` in `src/lib/report.ts` is the GitHub repo and does
   NOT change.
4. Add the new origin to `ALLOWED_ORIGIN` in `worker/wrangler.toml` and
   `npm run worker:deploy`, or every leaderboard submit from the new domain
   is a 403.
5. Known consequence: `localStorage` (streaks/history) does **not** carry across
   origins — players start fresh on the new domain. One-time cost.

## Client configuration — repo **Variables**

The site is a static bundle, so all its config is **public** (ships in the JS)
and is injected at build time from repo **Variables** (Settings → Secrets and
variables → Actions → **Variables**), never Secrets:

| Variable                    | Current value                    | Purpose                                                                                       |
| --------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| `VITE_CF_BEACON_TOKEN`      | _(unset)_                        | Cloudflare Web Analytics beacon — cookieless page views                                       |
| `VITE_LEADERBOARD_ENDPOINT` | the `cps-leaderboard` worker URL | anonymous daily leaderboard + server streak; **unset → the leaderboard UI is hidden**         |
| `VITE_BUG_ENDPOINT`         | the `cps-bug` worker URL         | in-app bug reports → GitHub issues; **unset → the form opens a prefilled issue page instead** |
| `VITE_TURNSTILE_SITEKEY`    | _(unset)_                        | optional Turnstile bot check on the bug form; pair with the worker secret `TURNSTILE_SECRET`  |

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
npm run worker:migrate   # FIRST: apply worker/migrations/*.sql to the REMOTE D1 (idempotent)
npm run worker:deploy    # THEN: wrangler deploy -c worker/wrangler.toml
```

Always migrate **before** deploying code that uses a new table: until a
migration is applied, the new code's queries against it fail (they are
best-effort and logged — e.g. `leaderboard lazy prune failed: no such table:
meta` — but nothing gets pruned). `wrangler d1 migrations apply` records what
it has applied in `d1_migrations`, so only new files run.

First-time setup (`wrangler d1 create cps-leaderboard` → paste the
`database_id` into the toml → migrate → deploy → set the Variable above → re-run
the deploy workflow) is in `worker/README.md`. `TURNSTILE_SECRET` is optional and
should stay unset until the client has an invisible Turnstile execute.

**Cron limit:** the account's Workers Free plan allows **5 cron triggers per
account** and they were all taken, so this worker has no `[triggers]` block
(the deploy failed on the schedules API until it was removed). Retention runs
lazily from submits instead (`pruneIfDue`, once per UTC day). To use a real
cron, free a slot on another worker or upgrade to Workers Paid, then restore
the block in `worker/wrangler.toml` and `npm run worker:deploy`.

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

## Bug worker (`cps-bug`)

A second Worker (`worker/bug-report.mjs`, config `worker/wrangler.bug.toml`)
receives the in-app bug form and files a GitHub issue with a token kept
server-side. Same by-hand deploy rule as the leaderboard worker.

**One-time setup:**

1. Create a **fine-grained personal access token** on GitHub (Settings →
   Developer settings → Fine-grained tokens): repository access = only
   `CampusPinShowdown`, permission **Issues: Read and write**, an expiry you
   will remember to renew.
2. `wrangler secret put GH_TOKEN -c worker/wrangler.bug.toml` (paste it).
3. `npm run bug:deploy` → prints `https://cps-bug.<account>.workers.dev`.
4. Set the repo Variable `VITE_BUG_ENDPOINT` to that URL and re-run the deploy
   workflow.

**Runbook:** every report failing with "couldn't send" = check
`wrangler tail -c worker/wrangler.bug.toml` for `github issue create failed`
(status 401 = expired/revoked PAT → mint a new one and `secret put` again;
403 = the PAT lacks Issues write or targets the wrong repo). Issues arrive
labelled `bug` + `from-app`; triage them like any other. If spam appears, add
Turnstile (`TURNSTILE_SECRET` on the worker + `VITE_TURNSTILE_SITEKEY` on the
site, hostname allowlisted in the Turnstile widget).

## Monitoring & bug reports

- The site has no backend; the optional leaderboard worker is best-effort
  (every failure path hides the line, never breaks the game). The Actions tab
  shows deploy health; `wrangler tail` shows the worker's logs.
- Players report bugs via the in-app **🐛 report a bug** form → a GitHub
  issue filed by the bug worker (message, puzzle date, URL, browser, and the
  session log buffer unless they untick it). Without `VITE_BUG_ENDPOINT` the
  form opens a prefilled issue page instead.
- Town/pin corrections: edit `data/towns-seed.json`, `npm run build-towns`,
  PR. Per-town ranking means a fix only changes the days that town was picked.
