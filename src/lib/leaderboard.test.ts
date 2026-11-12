import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BOARD,
  ordinal,
  percentile,
  formatStanding,
  getClientId,
  buildSubmitPayload,
  readStanding,
  submitDailyScore,
  fetchLeaderboard,
  refreshStanding,
  buildLeaderboardRows,
  mergeStreak,
  PERCENTILE_MIN_TOTAL,
} from './leaderboard'
import { log } from './log'

/** In-memory localStorage stub (vitest Node env has no DOM). */
function makeStorageStub(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    clear: () => map.clear(),
  } as Storage
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorageStub())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('ordinal + percentile', () => {
  it('handles the common cases and the 11–13 exception', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
    expect(ordinal(21)).toBe('21st')
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(112)).toBe('112th')
    expect(percentile(1, 100)).toBe(1)
    expect(percentile(50, 100)).toBe(50)
    expect(percentile(1, 1)).toBe(100)
  })
})

describe('formatStanding', () => {
  it('celebrates the first finisher, keeps small fields plain, adds a percentile at 20+', () => {
    expect(formatStanding({ rank: 1, total: 1 })).toMatch(/first to finish/i)
    expect(formatStanding({ rank: 3, total: 7 })).toBe(
      'You placed 3rd of 7 today',
    )
    expect(formatStanding({ rank: 5, total: PERCENTILE_MIN_TOTAL })).toMatch(
      /of 20 today · top \d+%/,
    )
  })
})

describe('getClientId + buildSubmitPayload', () => {
  it('mints a stable anonymous id and sends board/date/score/lineup — no PII', () => {
    expect(getClientId()).toBe(getClientId())
    const p = buildSubmitPayload({
      dateKey: '2026-10-29',
      score: 420,
      lineup: 'abc123',
      official: true,
    })
    expect(p).toMatchObject({
      board: BOARD,
      date: '2026-10-29',
      score: 420,
      lineup: 'abc123',
    })
    expect(p.clientId).toBe(getClientId())
    expect(JSON.stringify(p)).not.toMatch(/name|email/i)
  })
})

describe('submitDailyScore', () => {
  const args = {
    dateKey: '2026-10-29',
    score: 420,
    lineup: 'abc123',
    official: true,
  }

  it('does NOT submit a non-official game or when no endpoint is configured', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', 'https://lb.example')
    expect(await submitDailyScore({ ...args, official: false })).toBeNull()
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', '')
    expect(await submitDailyScore(args)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('submits an official game, returns + caches the standing (no re-POST on reload)', async () => {
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', 'https://lb.example')
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, rank: 3, total: 47 }),
    }))
    vi.stubGlobal('fetch', f)
    expect(await submitDailyScore(args)).toEqual({ rank: 3, total: 47 })
    expect(f).toHaveBeenCalledOnce()
    expect(readStanding('2026-10-29', 'abc123')).toEqual({ rank: 3, total: 47 })
    await submitDailyScore(args)
    expect(f).toHaveBeenCalledOnce() // served from cache
    // A changed lineup is a new completion → a second POST.
    await submitDailyScore({ ...args, lineup: 'def456', score: 380 })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('parses the server streak into the standing when present', async () => {
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', 'https://lb.example')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          rank: 2,
          total: 10,
          streak: { current: 4, best: 7 },
        }),
      })),
    )
    expect(await submitDailyScore(args)).toEqual({
      rank: 2,
      total: 10,
      streak: { current: 4, best: 7 },
    })
  })

  it('resolves null and logs (status + reason) when rejected; logs on network failure', async () => {
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', 'https://lb.example')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: 'invalid lineup' }),
      })),
    )
    const warn = vi.spyOn(log, 'warn')
    expect(await submitDailyScore(args)).toBeNull()
    const rejected = warn.mock.calls.find((c) => /reject/i.test(String(c[1])))
    expect(JSON.stringify(rejected?.[2])).toMatch(/400/)
    expect(JSON.stringify(rejected?.[2])).toMatch(/invalid lineup/)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(await submitDailyScore(args)).toBeNull()
    const net = warn.mock.calls.find((c) => /network/i.test(String(c[1])))
    expect(JSON.stringify(net?.[2])).toMatch(/offline/)
  })
})

describe('fetchLeaderboard', () => {
  it('returns null without an endpoint, on a rejected read, and on a network error', async () => {
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', '')
    expect(await fetchLeaderboard('2026-10-29')).toBeNull()
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', 'https://lb.example/')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => null })),
    )
    const warn = vi.spyOn(log, 'warn')
    expect(await fetchLeaderboard('2026-10-29')).toBeNull()
    expect(JSON.stringify(warn.mock.calls)).toMatch(/503/)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(await fetchLeaderboard('2026-10-29')).toBeNull()
  })

  it('fetches scores + total with board/date query params', async () => {
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', 'https://lb.example/')
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calledUrl = url
        return {
          ok: true,
          json: async () => ({ total: 9, scores: [500, 480] }),
        }
      }),
    )
    // A worker from before accounts sends no names: every row is anonymous.
    expect(await fetchLeaderboard('2026-10-29')).toEqual({
      total: 9,
      scores: [500, 480],
      names: ['', ''],
    })
    expect(calledUrl).toContain(`board=${BOARD}`)
    expect(calledUrl).toContain('date=2026-10-29')
  })
})

describe('fetchLeaderboard names', () => {
  it('keeps each display name paired with its score', async () => {
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', 'https://lb.example/')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          total: 3,
          scores: [500, 'junk', 480],
          names: ['Spicy Al', 'Dropped', 7],
        }),
      })),
    )
    expect(await fetchLeaderboard('2026-10-29')).toEqual({
      total: 3,
      scores: [500, 480],
      names: ['Spicy Al', ''],
    })
  })
})

describe('signed-in submissions', () => {
  it('the payload carries the session token and the rounds', () => {
    const rounds: [number, number, number, number][] = [[42, -83, 100, 0]]
    const p = buildSubmitPayload({
      dateKey: '2026-10-29',
      score: 100,
      lineup: 'abc123',
      official: true,
      token: 'f'.repeat(48),
      rounds,
    })
    expect(p.token).toBe('f'.repeat(48))
    expect(p.rounds).toEqual(rounds)
  })

  it('`force` re-posts past a cached standing (handing a day to the account)', async () => {
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', 'https://lb.example')
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ rank: 1, total: 1 }),
    }))
    vi.stubGlobal('fetch', f)
    const args = {
      dateKey: '2026-10-29',
      score: 420,
      lineup: 'abc123',
      official: true,
    }
    await submitDailyScore(args)
    await submitDailyScore(args) // cached: no second POST
    expect(f).toHaveBeenCalledTimes(1)
    await submitDailyScore({ ...args, force: true })
    expect(f).toHaveBeenCalledTimes(2)
  })
})

describe('mergeStreak', () => {
  it('shows the larger of local and server per field, and local alone without a server value', () => {
    expect(
      mergeStreak({ current: 30, best: 30 }, { current: 1, best: 1 }),
    ).toEqual({
      current: 30,
      best: 30,
    })
    expect(
      mergeStreak({ current: 2, best: 9 }, { current: 5, best: 5 }),
    ).toEqual({
      current: 5,
      best: 9,
    })
    expect(mergeStreak({ current: 3, best: 4 }, null)).toEqual({
      current: 3,
      best: 4,
    })
  })
})

describe('buildLeaderboardRows', () => {
  it('ranks highest-first with ties sharing a rank and flags the viewer once', () => {
    expect(buildLeaderboardRows([420, 480, 480, 300])).toEqual([
      { rank: 1, score: 480, name: '', you: false },
      { rank: 1, score: 480, name: '', you: false },
      { rank: 3, score: 420, name: '', you: false },
      { rank: 4, score: 300, name: '', you: false },
    ])
    const rows = buildLeaderboardRows([480, 420, 420], [420])
    expect(rows.filter((r) => r.you)).toHaveLength(1)
    expect(rows.find((r) => r.you)).toMatchObject({ rank: 2, score: 420 })
    expect(buildLeaderboardRows([480, 420], [333]).some((r) => r.you)).toBe(
      false,
    )
  })
})

describe('buildLeaderboardRows with names', () => {
  it('carries each name on its row, in rank order', () => {
    expect(
      buildLeaderboardRows([420, 480], [], ['Late Larry', 'Spicy Al']),
    ).toEqual([
      { rank: 1, score: 480, name: 'Spicy Al', you: false },
      { rank: 2, score: 420, name: 'Late Larry', you: false },
    ])
  })
  it('among tied scores, highlights the row with the viewer’s own name', () => {
    const rows = buildLeaderboardRows(
      [480, 480, 480],
      [480],
      ['', 'Stranger', 'Spicy Al'],
      'Spicy Al',
    )
    expect(rows.map((r) => r.you)).toEqual([false, false, true])
  })
  it('falls back to the first equal score when the name is not on the list', () => {
    const rows = buildLeaderboardRows([480, 480], [480], ['', ''], 'Spicy Al')
    expect(rows.map((r) => r.you)).toEqual([true, false])
  })
})

describe('refreshStanding', () => {
  it('refreshes total and recomputes an exact rank inside the returned window', () => {
    expect(
      refreshStanding(
        { rank: 2, total: 3 },
        { total: 5, scores: [500, 480, 460, 440, 420] },
        460,
      ),
    ).toEqual({ rank: 3, total: 5 })
    expect(
      refreshStanding(
        { rank: 1, total: 50 },
        { total: 200, scores: [500, 480, 460] },
        460,
      ),
    ).toEqual({ rank: 3, total: 200 })
  })
  it('keeps the cached rank (floored at window + 1) below a capped window, and keeps the streak', () => {
    expect(
      refreshStanding(
        { rank: 150, total: 80 },
        { total: 200, scores: [500, 480, 460] },
        300,
      ),
    ).toEqual({ rank: 150, total: 200 })
    expect(
      refreshStanding(
        { rank: 2, total: 10 },
        { total: 200, scores: [500, 480, 460] },
        300,
      ).rank,
    ).toBe(4)
    expect(
      refreshStanding(
        { rank: 1, total: 1, streak: { current: 4, best: 7 } },
        { total: 2, scores: [500, 480] },
        500,
      ),
    ).toEqual({ rank: 1, total: 2, streak: { current: 4, best: 7 } })
  })
})
