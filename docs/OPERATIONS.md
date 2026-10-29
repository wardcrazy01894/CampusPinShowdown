# Operations runbook

How the **live** site is hosted, deployed, and operated. (Architecture is in
[`PLAN.md`](PLAN.md); the dataset in [`DATA.md`](DATA.md).)

## Live site

- **URL:** <https://wardcrazy01894.github.io/CampusPinShowdown/>
- **Host:** GitHub Pages, Source = **GitHub Actions** (`build_type: workflow`),
  served as a **project page** — hence `base: '/CampusPinShowdown/'` in
  `vite.config.ts`. Every runtime fetch (`towns.json`, `version.json`) is
  base-relative, so moving to a custom domain is a one-line change (below).
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

## Deploy

- **Automatic:** every push to `main` runs `.github/workflows/deploy.yml`
  (test/lint/format gate → `npm run build` → upload Pages artifact → deploy).
  A couple of minutes; the live URL updates when the `deploy` run goes green.
- **Manual re-run:** Actions tab → **deploy** → **Run workflow**
  (`workflow_dispatch`). Needed after changing a repo Variable — Variables
  only take effect on the **next build**.
- **Rollback:** revert the offending PR on `main` (auto-redeploys), or
  Settings → Pages → disable to pull the site entirely.
- `deploy.yml` is **not** a required status check, so a failed deploy never
  blocks merges; it just means the last publish didn't happen. Check Actions.
- **Stale tabs:** the client polls `version.json` (emitted next to the bundle)
  on focus and every 5 min and reloads itself when the hash changes — unless
  the player is mid-round or parked on a past day's results (see
  `src/lib/version.ts`). No service worker, so a reload is all it takes.

## Custom domain (when the time comes)

1. Register the domain; point an **ALIAS/ANAME** on the apex (and a `CNAME`
   for `www`) at `wardcrazy01894.github.io`.
2. Settings → Pages → Custom domain = the apex; tick **Enforce HTTPS** once the
   certificate is issued. Add `public/CNAME` with the domain so the file ships
   in every artifact.
3. Flip `base` in `vite.config.ts` to `'/'`, and update the canonical/OG URLs in
   `index.html` and `REPO_URL`-adjacent links in the README.
4. Known consequence: `localStorage` (streaks/history) does **not** carry across
   origins — players start fresh on the new domain. One-time cost.

## Client configuration — repo **Variables**

The site is a static bundle, so all its config is **public** (ships in the JS)
and is injected at build time from repo **Variables** (Settings → Secrets and
variables → Actions → **Variables**), never Secrets:

| Variable               | Current value | Purpose                                                 |
| ---------------------- | ------------- | ------------------------------------------------------- |
| `VITE_CF_BEACON_TOKEN` | _(unset)_     | Cloudflare Web Analytics beacon — cookieless page views |

Nothing else. Map tiles (Esri Light Gray Canvas base) and geocoding (Nominatim,
build-time only) need no key.

## Repo protection

`main` is PR-only: required checks `build / typecheck / lint`, `test`,
`secret scan`; strict (branch up to date); conversation resolution required;
rules apply to admins; no force-push/deletion; squash merge; delete branch on
merge. Re-apply or audit with `bash scripts/protect-main.sh`. Dependabot alerts
and automated security fixes are enabled.

## Dependency updates

Dependabot (`.github/dependabot.yml`) opens **one grouped PR per ecosystem
per week** for minor+patch bumps (npm, GitHub Actions) and **one PR per major**.
Every Dependabot PR runs the same required checks and gets the same adversarial
review as any other change — green CI is necessary, not sufficient. Watch for
0.x packages riding the grouped PR (semver-minor there can be breaking).
TypeScript majors are ignored until typescript-eslint supports TS 7.

## Monitoring & bug reports

- No backend, so there is nothing to page on. The Actions tab shows deploy
  health; the Pages URL is the only runtime surface.
- Players report bugs via the in-app **🐛 report a bug** link → a prefilled
  GitHub issue (title, puzzle date, URL, browser). Ask them for
  `cpsDumpLogs()` output (browser console) when the report is thin.
- Town/pin corrections: edit `data/towns-seed.json`, `npm run build-towns`,
  PR. Per-town ranking means a fix only changes the days that town was picked.
