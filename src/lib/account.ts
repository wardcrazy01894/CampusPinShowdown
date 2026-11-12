/**
 * Optional accounts — client side (ported from WhereHePlay's api.ts).
 *
 * An account is a username, a password and a display name; no email. It
 * lives in the leaderboard Worker (worker/accounts-lib.mjs), so it is only
 * offered when `VITE_LEADERBOARD_ENDPOINT` is set. Signing in gives this
 * device a session token (`cps:account` in localStorage); from then on its
 * daily score is the ACCOUNT's, and src/lib/sync.ts keeps the streak and
 * today's result in step across every device signed in to it.
 *
 * Every call resolves to `{ ok: true, … }` or `{ ok: false, error }` — never
 * throws — so the game is fully playable when the worker is unset, down or
 * blocked.
 */

import { getClientId } from './leaderboard'
import { log } from './log'

const ACCOUNT_KEY = 'cps:account'

/** This device's sign-in. */
export interface Account {
  /** Session token (bearer). Only ever sent in a POST body. */
  token: string
  username: string
  /** Display name, shown on the leaderboard. */
  name: string
}

export function loadAccount(): Account | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY)
    if (!raw) return null
    const a = JSON.parse(raw) as Partial<Account> | null
    return typeof a?.token === 'string' &&
      typeof a.username === 'string' &&
      typeof a.name === 'string'
      ? { token: a.token, username: a.username, name: a.name }
      : null
  } catch {
    return null
  }
}

/** Remember the sign-in, or forget it (`null`). Best-effort. */
export function saveAccount(account: Account | null): void {
  try {
    if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
    else localStorage.removeItem(ACCOUNT_KEY)
  } catch (e) {
    log.warn('account', 'could not save sign-in', { error: String(e) })
  }
}

/** Accounts ride on the leaderboard worker: no endpoint, no accounts. */
export function accountsEnabled(): boolean {
  return Boolean(import.meta.env.VITE_LEADERBOARD_ENDPOINT)
}

/** `<endpoint>/<route>`, whether or not the endpoint ends in a slash. */
export function accountUrl(endpoint: string, route: string): string {
  return `${endpoint.replace(/\/+$/, '')}/${route}`
}

// ---- Form checks (the server validates again) -----------------------------------

/** What is wrong with a username, or null. Mirrors the worker's rule. */
export function usernameProblem(raw: string): string | null {
  const u = raw.trim().toLowerCase()
  if (u.includes('@'))
    return 'A username is not an email address. Make up any name: 3 to 20 letters, numbers or _.'
  if (u.length < 3 || u.length > 20) return 'A username is 3 to 20 characters.'
  if (!/^[a-z0-9_]+$/.test(u))
    return 'A username can use letters, numbers and _ only.'
  return null
}

export function passwordProblem(password: string): string | null {
  return password.length < 8 ? 'A password needs at least 8 characters.' : null
}

// ---- API ------------------------------------------------------------------------

export type ApiResult<T> =
  ({ ok: true } & T) | { ok: false; error: string; status?: number }

async function post<T>(route: string, body: unknown): Promise<ApiResult<T>> {
  const endpoint = import.meta.env.VITE_LEADERBOARD_ENDPOINT
  if (!endpoint) return { ok: false, error: 'offline' }
  try {
    const res = await fetch(accountUrl(endpoint, route), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok || data.ok !== true) {
      const error = String(data.error ?? `HTTP ${res.status}`)
      log.warn('account', `${route} refused`, { status: res.status, error })
      return { ok: false, error, status: res.status }
    }
    return data as ApiResult<T>
  } catch (e) {
    log.warn('account', `${route} failed (network)`, { error: String(e) })
    return { ok: false, error: 'network error' }
  }
}

/** A streak as the server keeps it. */
export interface ServerStreak {
  current: number
  best: number
  /** Last puzzle day counted, YYYY-MM-DD. */
  last: string
}

/** One round as the server stores it: [lat, lng, score, hinted (0|1)]. */
export type RoundTuple = [number, number, number, number]

/** One of the account's own recent results. */
export interface ServerDay {
  date: string
  /** progress.ts:lineupHash of the set that was played. */
  lineup: string
  score: number
  /** null for a day submitted before accounts existed. */
  rounds: RoundTuple[] | null
}

export interface Identity {
  username: string
  name: string
}
export interface Me extends Identity {
  /** Absent from a worker that predates accounts' sync. */
  streak?: ServerStreak | null
  days?: ServerDay[]
}

/** Client half of the split KDF (see worker/accounts-lib.mjs: hashPass). */
export const KDF_ITERATIONS = 150_000

/**
 * Stretch the password in the browser; only this key is ever sent. Salted
 * with the username, so the same password on two accounts gives two keys.
 */
export async function derivePass(
  username: string,
  password: string,
): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: enc.encode('cps:v1:' + username.trim().toLowerCase()),
      iterations: KDF_ITERATIONS,
    },
    key,
    256,
  )
  return Array.from(new Uint8Array(bits), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

/**
 * Create an account and sign this device in. `clientId` is the device's
 * anonymous id: the server moves what it already played (scores, streak) to
 * the new account, so there is no anonymous twin left on the board.
 */
export async function register(
  username: string,
  password: string,
  name: string,
) {
  return post<Identity & { token: string }>('register', {
    username,
    pass: await derivePass(username, password),
    name: name.trim() || undefined,
    clientId: getClientId(),
  })
}

/** Sign this device in; what it played anonymously joins the account. */
export async function login(username: string, password: string) {
  return post<Identity & { token: string }>('login', {
    username,
    pass: await derivePass(username, password),
    clientId: getClientId(),
  })
}

export const logout = (token: string) => post<object>('logout', { token })

export const setDisplayName = (token: string, name: string) =>
  post<Identity>('name', { token, name })

/**
 * Who this token is and what the account has. `streak` is this device's own
 * local streak, which the server folds into the account's before answering —
 * that is how an account inherits a streak built before it existed.
 */
export const fetchMe = (token: string, streak?: ServerStreak) =>
  post<Me>('me', { token, streak })

/** A sentence for the dialog from a failed call. */
export function friendlyError(r: { error: string; status?: number }): string {
  if (r.error === 'network error' || r.error === 'offline')
    return 'Couldn’t reach the server. Check your connection and try again.'
  // A worker deployed before accounts treats every POST as a score.
  if (r.error === 'unknown board' || r.status === 404 || r.status === 405)
    return 'Accounts aren’t switched on yet. Try again a little later.'
  if (r.status !== undefined && r.status >= 500)
    return 'The server is having trouble. Please try again in a minute.'
  const text = r.error.trim()
  const sentence = text.charAt(0).toUpperCase() + text.slice(1)
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
}
