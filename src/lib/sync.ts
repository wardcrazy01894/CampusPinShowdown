/**
 * Cross-device sync for a signed-in account (ported from WhereHePlay's
 * sync.ts, reshaped for this game's save).
 *
 * The server keeps the account's streak and its recent results WITH each
 * round's pin (worker `/me`). This folds them into the device's save, so
 * that on every device signed in to the account:
 *
 * - the streak is the same number — and when the account is new, it is the
 *   LONGER of the streaks its devices already had (each device vouches for
 *   its own local streak; the server merges them: worker mergeStreaks);
 * - a daily finished on another device shows as finished here, with its
 *   score and the full recap, instead of being offered again.
 *
 * `planSync` is pure (what should the save become); `syncProgress` does the
 * network and storage around it. What does NOT sync: a game still in
 * progress (only finished days reach the server), the lifetime per-tier
 * history, and display preferences.
 */

import type { GameState, RoundResult, Town } from '../types'
import {
  fetchMe,
  type Me,
  type RoundTuple,
  type ServerDay,
  type ServerStreak,
} from './account'
import { isValidDateKey } from './daily'
import { submitDailyScore } from './leaderboard'
import { log } from './log'
import {
  lineupHash,
  previousDateKey,
  recordCompletion,
  type Streak,
} from './progress'
import { sameLineup } from './resume'
import { MAX_ROUND_SCORE, haversineMeters, totalScore } from './scoring'
import {
  loadState,
  resetForSignOut,
  saveState,
  type PersistedState,
} from './storage'

export type { ServerDay, ServerStreak }

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0

/**
 * The device's streak and the account's, as one — the same rule the server
 * uses (worker mergeStreaks): the later last-played day decides; on the same
 * day the longer wins; consecutive days continue the run (at least the
 * earlier count + 1); a streak that lapsed before that does not come back,
 * though its best does. Returns `local` ITSELF when nothing changes.
 */
export function mergeServerStreak(
  local: Streak,
  server: ServerStreak | null | undefined,
): Streak {
  if (
    !server ||
    !isCount(server.current) ||
    !isCount(server.best) ||
    typeof server.last !== 'string' ||
    !isValidDateKey(server.last)
  )
    return local
  const mine = local.lastPlayedDateKey
  let current: number
  let last: string
  if (!mine || server.last > mine) {
    last = server.last
    current =
      mine && previousDateKey(server.last) === mine
        ? Math.max(server.current, local.current + 1)
        : server.current
  } else if (server.last === mine) {
    last = mine
    current = Math.max(local.current, server.current)
  } else {
    last = mine
    current =
      previousDateKey(mine) === server.last
        ? Math.max(local.current, server.current + 1)
        : local.current
  }
  const best = Math.max(local.best, server.best, current)
  if (
    current === local.current &&
    best === local.best &&
    last === local.lastPlayedDateKey
  )
    return local
  return { current, best, lastPlayedDateKey: last }
}

/** The local streak in the wire shape, for the server to fold into the
 *  account. Nothing for a device that has never finished a day. */
export function streakClaim(streak: Streak): ServerStreak | undefined {
  if (!streak.lastPlayedDateKey || streak.current < 1) return undefined
  return {
    current: streak.current,
    best: Math.max(streak.best, streak.current),
    last: streak.lastPlayedDateKey,
  }
}

/** A finished day's rounds as the server stores them. */
export function roundsOf(results: RoundResult[]): RoundTuple[] {
  return results.map((r) => [
    r.guess.lat,
    r.guess.lng,
    r.score,
    r.hinted ? 1 : 0,
  ])
}

const inRange = (n: unknown, lo: number, hi: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi

/**
 * The finished game behind one of the account's server results, for the
 * lineup this device would play on `dateKey` — or null when the row is not
 * one this build can show faithfully (another day, another lineup, no
 * per-round detail, or detail that does not add up).
 */
export function gameFromDay(
  dateKey: string,
  towns: Town[],
  day: ServerDay,
): GameState | null {
  if (day?.date !== dateKey || day.lineup !== lineupHash(towns)) return null
  const rounds = day.rounds
  if (!Array.isArray(rounds) || rounds.length !== towns.length) return null
  const results: RoundResult[] = []
  for (const [i, r] of rounds.entries()) {
    if (!Array.isArray(r)) return null
    const [lat, lng, score, hinted] = r
    if (!inRange(lat, -90, 90) || !inRange(lng, -180, 180)) return null
    if (!inRange(score, 0, MAX_ROUND_SCORE) || !Number.isInteger(score))
      return null
    const guess = { lat, lng }
    results.push({
      town: towns[i],
      guess,
      // The score is the stored one (it may carry a hint penalty); only the
      // distance is recomputed, and only for display.
      distanceMeters: haversineMeters(towns[i], guess),
      score,
      ...(hinted === 1 ? { hinted: true } : {}),
    })
  }
  if (totalScore(results) !== day.score) return null
  return {
    dateKey,
    towns,
    roundIndex: towns.length - 1,
    results,
    phase: 'finished',
  }
}

/** A day finished on this device that the account does not have (in full). */
export interface Unsent {
  dateKey: string
  lineup: string
  score: number
  rounds: RoundTuple[]
}

export interface SyncPlan {
  /** The save to write — `state` ITSELF when nothing changes. */
  state: PersistedState
  /** True when today's game was replaced by the one finished elsewhere (the
   *  mounted Game must be remounted to show it). */
  gameReplaced: boolean
  unsent: Unsent | null
}

export function planSync(input: {
  state: PersistedState
  me: Pick<Me, 'streak' | 'days'>
  /** The puzzle day this session is on, and its lineup. */
  dateKey: string
  towns: Town[]
}): SyncPlan {
  const { state, me, dateKey, towns } = input
  let streak = mergeServerStreak(state.streak, me?.streak)
  let { history, current } = state
  let gameReplaced = false
  let unsent: Unsent | null = null

  const lineup = lineupHash(towns)
  const finishedHere =
    !!current &&
    current.dateKey === dateKey &&
    current.phase === 'finished' &&
    sameLineup(current.towns, towns)
  // Best score first (the server orders them); the first one we can show.
  let theirs: GameState | null = null
  for (const day of Array.isArray(me?.days) ? me.days : []) {
    theirs = gameFromDay(dateKey, towns, day)
    if (theirs) break
  }

  if (finishedHere) {
    // Never swap out a day this device finished. If the account lacks it (it
    // was played before signing in, offline, or before rounds were stored),
    // hand it over.
    if (!theirs)
      unsent = {
        dateKey,
        lineup,
        score: totalScore(current!.results),
        rounds: roundsOf(current!.results),
      }
  } else if (theirs) {
    // Finished on another device: that is today's game here too — also over
    // one only in progress here (playing it out would be a second attempt).
    current = theirs
    gameReplaced = true
    // Same bookkeeping as finishing it here. The streak normally already
    // counts today (it came from the server); if the server's best-effort
    // streak write missed it, this bumps it exactly once.
    const folded = recordCompletion(history, streak, {
      dateKey,
      lineup,
      totalScore: totalScore(theirs.results),
      results: theirs.results.map((r) => ({
        distanceMeters: r.distanceMeters,
        score: r.score,
        difficulty: r.town.difficulty,
      })),
    })
    history = folded.history
    streak = folded.streak
  }

  if (!gameReplaced && streak === state.streak)
    return { state, gameReplaced, unsent }
  return {
    state: { ...state, current, history, streak },
    gameReplaced,
    unsent,
  }
}

export interface SyncResult {
  /** 'signed-out': the server no longer knows this token. 'offline': no
   *  answer worth acting on (network, outage, a worker without accounts). */
  status: 'ok' | 'signed-out' | 'offline'
  /** The device's save changed (re-read anything shown from it). */
  changed: boolean
  gameReplaced: boolean
  /** The account as the server has it (a name changed on another device). */
  username?: string
  name?: string
}

/** Hand-overs already tried this page load: one attempt each, so a day the
 *  server refuses is not re-posted every time the tab comes back. A reload
 *  tries again. */
const attempted = new Set<string>()

/**
 * Ask the server what the account has and apply it to this device's save.
 * `storageId` must be the OFFICIAL daily's namespace, `dateKey`/`towns` the
 * session's day and lineup.
 *
 * The save remembers which account it was last synced to (`owner`). If that
 * is a DIFFERENT account — a shared device whose previous session the server
 * ended, so nothing was wiped — the save is reset first: its streak and
 * finished day are someone else's and must not be claimed for this account.
 */
export async function syncProgress(input: {
  token: string
  /** The signed-in account's username. */
  username: string
  storageId: string
  dateKey: string
  towns: Town[]
}): Promise<SyncResult> {
  const { token, username, storageId, dateKey, towns } = input
  const before = loadState(storageId)
  const foreign = before.owner !== undefined && before.owner !== username
  if (foreign) {
    log.info('sync', 'save belonged to another account — reset')
    resetForSignOut(storageId)
  }
  // A reset save drops the game on screen, whatever the server then says.
  const none = { changed: foreign, gameReplaced: foreign }
  const me = await fetchMe(token, streakClaim(loadState(storageId).streak))
  if (!me.ok)
    return { status: me.status === 401 ? 'signed-out' : 'offline', ...none }

  // Read the save AFTER the await: the player may have finished a round (or
  // the day) while the request was in flight.
  const state = loadState(storageId)
  const plan = planSync({ state, me, dateKey, towns })
  let changed = foreign || plan.state !== state
  if (plan.state !== state || state.owner !== username) {
    saveState(storageId, { ...plan.state, owner: username })
    log.info('sync', 'applied account progress', {
      gameReplaced: plan.gameReplaced,
      streak: plan.state.streak.current,
    })
  }

  const u = plan.unsent
  const key = u && `${token}|${u.dateKey}|${u.lineup}`
  if (u && key && !attempted.has(key)) {
    attempted.add(key)
    const standing = await submitDailyScore({
      dateKey: u.dateKey,
      score: u.score,
      lineup: u.lineup,
      rounds: u.rounds,
      token,
      official: true,
      // The cached standing only says the DEVICE submitted this day.
      force: true,
    })
    if (standing?.streak) {
      const now = loadState(storageId)
      const merged = mergeServerStreak(now.streak, {
        ...standing.streak,
        last: u.dateKey,
      })
      if (merged !== now.streak) {
        saveState(storageId, { ...now, streak: merged })
        changed = true
      }
    }
  }
  return {
    status: 'ok',
    changed,
    gameReplaced: foreign || plan.gameReplaced,
    username: me.username,
    name: me.name,
  }
}
