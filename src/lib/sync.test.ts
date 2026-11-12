import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { GameState, Town } from '../types'
import {
  defaultState,
  loadState,
  saveState,
  type PersistedState,
} from './storage'
import { lineupHash } from './progress'
import { haversineMeters } from './scoring'
import {
  mergeServerStreak,
  roundsOf,
  gameFromDay,
  planSync,
  streakClaim,
  syncProgress,
  type ServerDay,
} from './sync'

/**
 * Cross-device sync, the pure part: given what this device has saved and what
 * the account has on the server, what should the device's save become?
 */

const town = (id: string, lat: number, lng: number): Town => ({
  id,
  name: id,
  state: 'Michigan',
  stateCode: 'MI',
  schools: [`University of ${id}`],
  lat,
  lng,
  difficulty: 'easy',
  source: 'manual',
  attribution: 't',
})
const TOWNS = [
  town('a', 42, -83),
  town('b', 30, -97),
  town('c', 40, -105),
  town('d', 35, -79),
  town('e', 44, -123),
]
const TODAY = '2026-11-12'
const YESTERDAY = '2026-11-11'
const LINEUP = lineupHash(TOWNS)
const ROUNDS: ServerDay['rounds'] = [
  [42, -83, 100, 0],
  [30.5, -97, 90, 0],
  [41, -105, 80, 1],
  [36, -79, 70, 0],
  [45, -123, 60, 0],
]
const DAY: ServerDay = {
  date: TODAY,
  lineup: LINEUP,
  score: 400,
  rounds: ROUNDS,
}

const finishedGame = (score = 50): GameState => ({
  dateKey: TODAY,
  towns: TOWNS,
  roundIndex: 4,
  phase: 'finished',
  results: TOWNS.map((t) => ({
    town: t,
    guess: { lat: t.lat + 1, lng: t.lng },
    distanceMeters: 111_000,
    score,
  })),
})
const state = (over: Partial<PersistedState> = {}): PersistedState => ({
  ...defaultState(),
  ...over,
})
const streak = (current: number, last: string | null, best = current) => ({
  current,
  best,
  lastPlayedDateKey: last,
})

describe('mergeServerStreak', () => {
  it('takes the longer streak when both last played the same day', () => {
    expect(
      mergeServerStreak(streak(5, TODAY), {
        current: 12,
        best: 12,
        last: TODAY,
      }),
    ).toEqual(streak(12, TODAY))
    expect(
      mergeServerStreak(streak(12, TODAY), {
        current: 5,
        best: 5,
        last: TODAY,
      }),
    ).toEqual(streak(12, TODAY))
  })
  it('follows the account when it played more recently (another device)', () => {
    expect(
      mergeServerStreak(streak(12, YESTERDAY), {
        current: 13,
        best: 13,
        last: TODAY,
      }),
    ).toEqual(streak(13, TODAY))
  })
  it('continues a run the server only partly knows', () => {
    // Local: 12 through yesterday. Server: a fresh "1" for today.
    expect(
      mergeServerStreak(streak(12, YESTERDAY), {
        current: 1,
        best: 1,
        last: TODAY,
      }),
    ).toEqual(streak(13, TODAY))
  })
  it('a lapsed local streak gives way; its best is kept', () => {
    expect(
      mergeServerStreak(streak(12, '2026-11-01'), {
        current: 2,
        best: 2,
        last: TODAY,
      }),
    ).toEqual(streak(2, TODAY, 12))
  })
  it('returns the SAME object when nothing changes, and survives junk', () => {
    const local = streak(12, TODAY)
    expect(
      mergeServerStreak(local, { current: 12, best: 12, last: TODAY }),
    ).toBe(local)
    expect(mergeServerStreak(local, null)).toBe(local)
    expect(
      mergeServerStreak(local, { current: -1, best: 2, last: 'nope' }),
    ).toBe(local)
  })
  it('a device that has never played takes the account streak', () => {
    expect(
      mergeServerStreak(streak(0, null, 0), {
        current: 12,
        best: 14,
        last: TODAY,
      }),
    ).toEqual(streak(12, TODAY, 14))
  })
})

describe('streakClaim', () => {
  it('is the local streak in the wire shape; nothing for a device that never played', () => {
    expect(streakClaim(streak(5, TODAY, 9))).toEqual({
      current: 5,
      best: 9,
      last: TODAY,
    })
    expect(streakClaim(streak(0, null, 0))).toBeUndefined()
  })
})

describe('roundsOf / gameFromDay round-trip', () => {
  it('packs results as [lat, lng, score, hinted]', () => {
    const g = finishedGame()
    g.results[2].hinted = true
    const r = roundsOf(g.results)
    expect(r[0]).toEqual([43, -83, 50, 0])
    expect(r[2][3]).toBe(1)
  })

  it('rebuilds the finished game another device played', () => {
    const g = gameFromDay(TODAY, TOWNS, DAY)!
    expect(g.phase).toBe('finished')
    expect(g.dateKey).toBe(TODAY)
    expect(g.towns).toBe(TOWNS)
    expect(g.results.map((r) => r.score)).toEqual([100, 90, 80, 70, 60])
    expect(g.results[1].guess).toEqual({ lat: 30.5, lng: -97 })
    expect(g.results[1].distanceMeters).toBeCloseTo(
      haversineMeters(TOWNS[1], { lat: 30.5, lng: -97 }),
    )
    expect(g.results[2].hinted).toBe(true)
    expect(g.results[0].hinted).toBeUndefined()
  })

  it('refuses a day it cannot show faithfully', () => {
    expect(gameFromDay(TODAY, TOWNS, { ...DAY, rounds: null })).toBeNull()
    expect(gameFromDay(TODAY, TOWNS, { ...DAY, score: 401 })).toBeNull()
    expect(gameFromDay(TODAY, TOWNS, { ...DAY, lineup: 'other' })).toBeNull()
    expect(gameFromDay(YESTERDAY, TOWNS, DAY)).toBeNull()
    expect(
      gameFromDay(TODAY, TOWNS, { ...DAY, rounds: ROUNDS!.slice(0, 4) }),
    ).toBeNull()
    expect(
      gameFromDay(TODAY, TOWNS, {
        ...DAY,
        rounds: [['x', 0, 100, 0], ...ROUNDS!.slice(1)] as never,
      }),
    ).toBeNull()
  })
})

describe('planSync', () => {
  const me = (over = {}) => ({
    streak: { current: 12, best: 12, last: TODAY },
    days: [DAY],
    ...over,
  })

  it('a device that has not played today shows the day finished elsewhere', () => {
    const plan = planSync({
      state: state({ streak: streak(5, YESTERDAY) }),
      me: me(),
      dateKey: TODAY,
      towns: TOWNS,
    })
    expect(plan.gameReplaced).toBe(true)
    expect(plan.state.current?.phase).toBe('finished')
    expect(plan.state.current?.results.map((r) => r.score)).toEqual([
      100, 90, 80, 70, 60,
    ])
    expect(plan.state.streak).toEqual(streak(12, TODAY))
    expect(plan.state.history).toEqual([
      expect.objectContaining({
        dateKey: TODAY,
        totalScore: 400,
        lineup: LINEUP,
      }),
    ])
    expect(plan.unsent).toBeNull()
  })

  it('the account’s finished day also wins over a game only in progress here', () => {
    const inProgress: GameState = {
      ...finishedGame(),
      phase: 'guessing',
      roundIndex: 2,
      results: finishedGame().results.slice(0, 2),
    }
    const plan = planSync({
      state: state({ current: inProgress }),
      me: me(),
      dateKey: TODAY,
      towns: TOWNS,
    })
    expect(plan.gameReplaced).toBe(true)
    expect(plan.state.current?.phase).toBe('finished')
  })

  it('never swaps out a day this device already finished', () => {
    const mine = finishedGame()
    const s = state({ current: mine, streak: streak(12, TODAY) })
    const plan = planSync({ state: s, me: me(), dateKey: TODAY, towns: TOWNS })
    expect(plan.gameReplaced).toBe(false)
    expect(plan.state).toBe(s) // nothing to write
    expect(plan.unsent).toBeNull()
  })

  it('hands the account a day finished here that it does not have', () => {
    const mine = finishedGame()
    const plan = planSync({
      state: state({ current: mine, streak: streak(3, TODAY) }),
      me: me({ days: [], streak: null }),
      dateKey: TODAY,
      towns: TOWNS,
    })
    expect(plan.unsent).toEqual({
      dateKey: TODAY,
      lineup: LINEUP,
      score: 250,
      rounds: roundsOf(mine.results),
    })
    expect(plan.gameReplaced).toBe(false)
  })

  it('re-sends a day the server holds without its rounds (played before accounts)', () => {
    const plan = planSync({
      state: state({ current: finishedGame(), streak: streak(12, TODAY) }),
      me: me({ days: [{ ...DAY, rounds: null }] }),
      dateKey: TODAY,
      towns: TOWNS,
    })
    expect(plan.unsent).not.toBeNull()
  })

  it('ignores a server day for another date or another lineup', () => {
    const s = state()
    const plan = planSync({
      state: s,
      me: me({
        streak: null,
        days: [
          { ...DAY, date: YESTERDAY },
          { ...DAY, lineup: 'changed' },
        ],
      }),
      dateKey: TODAY,
      towns: TOWNS,
    })
    expect(plan.state).toBe(s)
    expect(plan.gameReplaced).toBe(false)
  })

  it('updates only the streak when that is all that differs', () => {
    const s = state({ streak: streak(5, YESTERDAY) })
    const plan = planSync({
      state: s,
      me: me({ days: [], streak: { current: 12, best: 12, last: YESTERDAY } }),
      dateKey: TODAY,
      towns: TOWNS,
    })
    expect(plan.gameReplaced).toBe(false)
    expect(plan.state.streak).toEqual(streak(12, YESTERDAY))
    expect(plan.state.current).toBeUndefined()
  })

  it('tolerates a worker that predates accounts (no streak, no days)', () => {
    const s = state({ streak: streak(5, TODAY) })
    const plan = planSync({
      state: s,
      me: {} as never,
      dateKey: TODAY,
      towns: TOWNS,
    })
    expect(plan.state).toBe(s)
  })

  it('a streak the server did not count for today is still bumped once', () => {
    // The server's best-effort streak write failed: it has today's score but
    // its streak still ends yesterday.
    const plan = planSync({
      state: state(),
      me: me({ streak: { current: 4, best: 4, last: YESTERDAY } }),
      dateKey: TODAY,
      towns: TOWNS,
    })
    expect(plan.state.streak).toEqual(streak(5, TODAY))
  })
})

describe('syncProgress — whose save is this?', () => {
  const TOKEN = 'f'.repeat(48)
  let bodies: Record<string, unknown>[]
  beforeEach(() => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    })
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', 'https://lb.example')
    bodies = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)))
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            username: 'spicy_al',
            name: 'Al',
            streak: null,
            days: [],
          }),
        }
      }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  const run = () =>
    syncProgress({
      token: TOKEN,
      username: 'spicy_al',
      storageId: 'usa',
      dateKey: TODAY,
      towns: TOWNS,
    })

  it('stamps an unowned save with the account it synced to', async () => {
    saveState('usa', state({ streak: streak(7, TODAY) }))
    await run()
    expect(bodies[0].streak).toEqual({ current: 7, best: 7, last: TODAY })
    expect(loadState('usa').owner).toBe('spicy_al')
    expect(loadState('usa').streak).toEqual(streak(7, TODAY))
  })

  it('never offers ANOTHER account’s streak or finished day as this one’s', async () => {
    // A shared device: the previous player's session was ended by the server
    // (so nothing was wiped), then someone else signed in.
    saveState(
      'usa',
      state({
        owner: 'someone_else',
        streak: streak(12, TODAY),
        current: finishedGame(),
      }),
    )
    const r = await run()
    expect(bodies).toHaveLength(1) // /me only: no day handed over
    expect(bodies[0].streak).toBeUndefined()
    const saved = loadState('usa')
    expect(saved.streak.current).toBe(0)
    expect(saved.current).toBeUndefined()
    expect(saved.owner).toBe('spicy_al')
    // The mounted game must be replaced: it was the other player's.
    expect(r.gameReplaced).toBe(true)
  })
})
