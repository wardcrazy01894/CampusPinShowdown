# Leaderboard + accounts worker (`cps-leaderboard`)

A tiny [Cloudflare Worker](https://workers.cloudflare.com/) + [D1](https://developers.cloudflare.com/d1/)
(serverless SQLite) behind the **daily leaderboard** and the optional
**accounts**: store a keep-max score per `(board, date, player, lineup)` and
answer "you placed **Xth of Y** today". Its own worker, database and rate-limit namespace — nothing is shared
with KnowYourCity's `kyc-leaderboard` (the code is a port of it).

- **Anonymous by default.** Identity is a random UUID in the browser's
  `localStorage` (`cps:clientId`) — no PII.
- **Optional accounts** (`accounts-lib.mjs`, migration `0004`): username +
  password + display name, **no email**. A signed-in player's rows are keyed
  `acct:<id>` in the same `client_id` column (a device id cannot contain `:`),
  so they are one competitor across devices and the board shows their display
  name. Passwords arrive already stretched by the browser and are stretched
  again with a per-account salt; session tokens are stored as SHA-256 only.
  Design: `docs/PLAN.md` §Accounts. (`user_id`, reserved in 0001/0002, stays
  unused.)
- **Official games only.** The client submits only the real daily; `?shuffle`
  and `?date=` never submit. The worker independently rejects unknown boards
  and any date outside `[UTC today − 2, UTC today + 1]` (the puzzle day is the
  player's LOCAL day, which can differ from UTC by a day either way).
- **One human = one competitor.** Rows are stored per `(device, lineup)` so a
  changed-set replay keeps its own row, but rank/total/board are computed over
  each device's best score.
- **Fails closed.** The per-IP rate limit (`[[ratelimits]]` in `wrangler.toml`,
  30/60 s) is on by default, so a fresh deploy is not wide-open. Anti-cheat is a
  documented non-goal (scores are client-computed); Turnstile is plumbed
  through (`TURNSTILE_SECRET`) for the day abuse appears.
- **Per-player streak** in its own `streaks` table (survives the prune) —
  returned with the standing; the UI prefers it over the local streak.
- **Bounded storage.** `scores` older than 90 days are pruned lazily on a
  submit, at most once per UTC day (`meta.last_prune`, migration `0003`) — the
  account's Workers Free plan has no cron slot left (5 per account).
- **Optional.** Behind `VITE_LEADERBOARD_ENDPOINT`; unset → the UI is hidden.

Request/response shape:

- **Submit:** `POST { board: "usa", date, score, clientId, lineup, rounds?, token?, turnstileToken? }`
  → `{ ok, rank, total, streak? }` (`streak` = `{ current, best }`). `rounds`
  is `[[lat, lng, score, hinted], …]` (five, adding up to `score`); with a
  valid session `token` the score is the account's.
- **View:** `GET ?board=usa&date=` → `{ ok, total, scores[], names[] }` — the
  day's top 100 best-per-player scores (desc); `names[i]` is the display name
  of a signed-in player, `''` otherwise.
- **Accounts** (all `POST`, JSON; the last path segment is the route; a token
  never travels in a URL):
  - `/register { username, pass, name?, clientId? }` → `{ ok, token, username, name }`
  - `/login { username, pass, clientId? }` → `{ ok, token, username, name }`
    (one `401 wrong username or password` for every failure)
  - `/logout { token }` → `{ ok }`
  - `/me { token, streak? }` → `{ ok, username, name, streak, days[] }` —
    `streak` in the body is the device's local streak `{ current, best, last }`
    to merge in; the answer is the account's streak and its results inside the
    submission window (`{ date, lineup, score, rounds }`). `401` = signed out.
  - `/name { token, name }` → `{ ok, username, name }`
  - `/password { token, pass, newPass }` → `{ ok, username, name }` — `pass`
    is the current password's key (`401 wrong password` otherwise); every
    other session of the account is ended. A _forgotten_ password is reset by
    the owner with `npm run account:reset-password` (`docs/OPERATIONS.md`),
    never through the worker.

  `pass` is the 64-hex key the browser derives (PBKDF2), never the password.
  `clientId` hands the device's anonymous scores and streak to the account.
  `/register` and `/login` need the `LOGIN_LIMITER` binding (5/min) and fail
  closed without it.

> ⚠️ **Shipping accounts: migrate FIRST, then deploy.** The worker code reads
> `scores.rounds` and joins `accounts` on every submit and every board read,
> so deployed ahead of migration `0004_accounts.sql` it answers 503 to
> everyone until the migration runs. `npm run worker:migrate`, then
> `npm run worker:deploy` — the migration is additive and safe to apply first.

## Try it locally first (no production resources)

```bash
npm run worker:migrate:local   # local D1 under .wrangler/ (gitignored)
npm run worker:dev             # http://localhost:8787
echo 'VITE_LEADERBOARD_ENDPOINT=http://localhost:8787' >> .env.local
npm run dev                    # localhost:5173 is in ALLOWED_ORIGIN
```

Finish the **official** day and you'll see "🏆 You're the first to finish
today!"; a second browser profile gets a new `clientId` and grows `Y`.

## Deploy (one time, free tier)

Needs the Wrangler CLI (`npm i -g wrangler`) logged in to the Cloudflare
account (`wrangler login`).

```bash
wrangler d1 create cps-leaderboard   # paste the printed database_id into worker/wrangler.toml
npm run worker:migrate               # apply migrations to the REMOTE database
npm run worker:deploy                # prints https://cps-leaderboard.<you>.workers.dev
```

Then set the repo **Variable** `VITE_LEADERBOARD_ENDPOINT` to that URL and
re-run the deploy workflow so the site bakes it in. Later schema changes are
new files in `worker/migrations/` applied with `npm run worker:migrate`; worker
code changes are `npm run worker:deploy` — **neither happens automatically on
merge** (see `docs/OPERATIONS.md`).

## Tests

`worker/leaderboard.test.mjs` (pure validation), `leaderboard-db.test.mjs`
(the SQL against a real `node:sqlite` with the real migrations),
`leaderboard.handler.test.mjs` (the request path with a fake D1/KV),
`accounts.test.mjs` (validation, the streak merge, the account SQL) and
`accounts.handler.test.mjs` (the account routes end to end on real SQLite;
`d1-test-helper.mjs` is the shared adapter). All run
under `npm test`; `npm run typecheck` includes `tsconfig.worker.json`.

---

# Bug-report worker (`cps-bug`)

`worker/bug-report.mjs` (config `worker/wrangler.bug.toml`) receives the
in-app "🐛 report a bug" form and files a **GitHub issue** so the token stays
server-side. Its own worker and rate-limit namespace; it imports the
leaderboard lib's CORS/origin helpers, which is why it lives in this
directory. Request: `POST { message, context: { date, url, userAgent }, logs,
turnstileToken? }` → `{ ok, url }`.

Hardening (same as KnowYourCity's): fails closed without a rate limit or
Turnstile; 5 reports / IP / 60 s; server-side Origin allowlist; 20 KB body
cap + per-field caps; `defang()` (bug-report-lib.mjs) neutralises @mentions,
code fences, Markdown links/images, raw HTML and `#123` cross-references; the
reported URL is kept only if it is from our own origin.

Deploy: `wrangler secret put GH_TOKEN -c worker/wrangler.bug.toml` (a
fine-grained PAT, Issues: read & write, this repo only), then
`npm run bug:deploy`, then set the repo Variable `VITE_BUG_ENDPOINT`. Local:
`npm run bug:dev` (port 8789) with `VITE_BUG_ENDPOINT=http://localhost:8789`
in `.env.local` — you still need a `GH_TOKEN` in `worker/.dev.vars` for the
issue to be created (gitignored).
