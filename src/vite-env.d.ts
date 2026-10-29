/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional app version string surfaced in logs. */
  readonly VITE_APP_VERSION?: string
  /** Optional Cloudflare Web Analytics beacon token (public) — page-view
   *  tracking when set; see .env.example. */
  readonly VITE_CF_BEACON_TOKEN?: string
  /** Git short hash injected at build time; compared against version.json to
   *  detect a new deploy in open tabs. */
  readonly VITE_BUILD_HASH?: string
  /** Leaderboard worker URL (public); unset → leaderboard UI hidden. */
  readonly VITE_LEADERBOARD_ENDPOINT?: string
  /** Bug-report worker URL (public); unset → prefilled GitHub issue page. */
  readonly VITE_BUG_ENDPOINT?: string
  /** Optional Cloudflare Turnstile site key for the bug form (public). */
  readonly VITE_TURNSTILE_SITEKEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
