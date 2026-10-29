import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  defaultState,
  loadState,
  saveState,
  clearState,
  applyStartupReset,
  STORAGE_VERSION,
  type PersistedState,
} from './storage'

/**
 * Minimal in-memory localStorage stub. vitest runs in the node environment (no
 * DOM), so we install our own Storage-shaped object on globalThis for these
 * tests. Each test gets a fresh one.
 */
function makeStorageStub() {
  const map = new Map<string, string>()
  return {
    map,
    storage: {
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
    } as Storage,
  }
}

let stub: ReturnType<typeof makeStorageStub>

beforeEach(() => {
  stub = makeStorageStub()
  vi.stubGlobal('localStorage', stub.storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const sample = (over: Partial<PersistedState> = {}): PersistedState => ({
  version: STORAGE_VERSION,
  history: [{ dateKey: '2026-06-09', totalScore: 420, results: [] }],
  streak: { current: 3, best: 5, lastPlayedDateKey: '2026-06-09' },
  ...over,
})

describe('defaultState', () => {
  it('is a valid empty state at the current version', () => {
    const s = defaultState()
    expect(s.version).toBe(STORAGE_VERSION)
    expect(s.history).toEqual([])
    expect(s.streak).toEqual({ current: 0, best: 0, lastPlayedDateKey: null })
  })
})

describe('loadState', () => {
  it('returns a fresh default when nothing is saved', () => {
    expect(loadState('usa')).toEqual(defaultState())
  })

  it('round-trips a saved state via saveState', () => {
    const state = sample()
    saveState('usa', state)
    expect(loadState('usa')).toEqual(state)
  })

  it('writes under the cps: prefix (pins the key the seeded tests below rely on)', () => {
    saveState('usa', sample())
    expect(stub.map.has(`cps:v${STORAGE_VERSION}:usa`)).toBe(true)
  })

  it('resets to default on a version mismatch (schema bump must not brick players)', () => {
    // Simulate data written by an older build with a different version.
    stub.map.set(
      `cps:v${STORAGE_VERSION}:usa`,
      JSON.stringify({ ...sample(), version: STORAGE_VERSION - 1 }),
    )
    expect(loadState('usa')).toEqual(defaultState())
  })

  it('returns default (never throws) on corrupt JSON', () => {
    stub.map.set(`cps:v${STORAGE_VERSION}:usa`, '{ not valid json ]')
    expect(() => loadState('usa')).not.toThrow()
    expect(loadState('usa')).toEqual(defaultState())
  })

  it('returns default (never throws) when storage access throws', () => {
    // Throw on ANY access (e.g. Safari private mode), not just getItem — so the
    // test still guards if loadState is ever refactored to touch storage
    // differently (otherwise it could pass on an unrelated TypeError).
    vi.stubGlobal(
      'localStorage',
      new Proxy(
        {},
        {
          get() {
            throw new Error('SecurityError: storage disabled')
          },
        },
      ) as unknown as Storage,
    )
    expect(() => loadState('usa')).not.toThrow()
    expect(loadState('usa')).toEqual(defaultState())
  })

  it('namespaces state per id (one namespace does not leak into another)', () => {
    const sp = sample({
      streak: { current: 7, best: 7, lastPlayedDateKey: 'x' },
    })
    saveState('usa', sp)
    expect(loadState('usa')).toEqual(sp)
    expect(loadState('usa__date')).toEqual(defaultState())
  })
})

describe('loadState shape check', () => {
  it('treats a right-version but malformed value as corrupt (no deep throw later)', () => {
    stub.map.set(
      `cps:v${STORAGE_VERSION}:usa`,
      JSON.stringify({ version: STORAGE_VERSION }),
    )
    expect(loadState('usa')).toEqual(defaultState())
  })

  it('rejects streak: null (typeof null is "object") — bumpStreak would throw on completion', () => {
    stub.map.set(
      `cps:v${STORAGE_VERSION}:usa`,
      JSON.stringify({ version: STORAGE_VERSION, history: [], streak: null }),
    )
    expect(loadState('usa')).toEqual(defaultState())
  })

  it('rejects a current game without a towns array — sameLineup would throw on load', () => {
    stub.map.set(
      `cps:v${STORAGE_VERSION}:usa`,
      JSON.stringify({ ...sample(), current: { dateKey: '2026-10-29' } }),
    )
    expect(loadState('usa')).toEqual(defaultState())
  })
})

describe('saveState', () => {
  it('swallows quota/serialization errors (best-effort, never throws)', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    } as unknown as Storage)
    expect(() => saveState('usa', sample())).not.toThrow()
  })
})

describe('clearState', () => {
  it('removes ONLY the given key, leaving other namespaces intact', () => {
    saveState('usa', sample())
    saveState('usa__shuffle', sample())
    saveState('usa__date', sample())
    stub.map.set('unrelated:key', 'keep-me')
    clearState('usa')
    // Only the official usa save is gone.
    expect(loadState('usa')).toEqual(defaultState())
    // The isolated shuffle and date namespaces are untouched.
    expect(loadState('usa__shuffle')).not.toEqual(defaultState())
    expect(loadState('usa__date')).not.toEqual(defaultState())
    expect(stub.map.get('unrelated:key')).toBe('keep-me')
  })

  it('never throws when storage access fails', () => {
    vi.stubGlobal('localStorage', {
      removeItem: () => {
        throw new Error('disabled')
      },
    } as unknown as Storage)
    expect(() => clearState('usa')).not.toThrow()
  })
})

describe('applyStartupReset', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does nothing and returns false when there is no fresh-start flag', () => {
    vi.stubGlobal('window', { location: { search: '' } })
    saveState('usa', sample())
    expect(applyStartupReset('usa')).toBe(false)
    expect(loadState('usa')).not.toEqual(defaultState())
  })

  it('drops the current game but KEEPS history + streak when the URL asks for a fresh start', () => {
    // The bug: ?reset used to wipe the whole key — a bookmarked ?reset link
    // zeroed a 30-day streak on every visit.
    vi.stubGlobal('window', { location: { search: '?reset' } })
    const before = sample({
      current: {
        dateKey: '2026-10-29',
        towns: [],
        roundIndex: 2,
        results: [],
        phase: 'guessing',
      },
    })
    saveState('usa', before)
    expect(applyStartupReset('usa')).toBe(true)
    const after = loadState('usa')
    expect(after.current).toBeUndefined()
    expect(after.history).toEqual(before.history)
    expect(after.streak).toEqual(before.streak)
  })

  it('a ?shuffle reset clears ONLY the shuffle namespace, never the official daily', () => {
    // The bug: ?shuffle wiped the real in-progress daily via a blanket clear.
    vi.stubGlobal('window', { location: { search: '?shuffle' } })
    const game = {
      dateKey: '2026-10-29',
      towns: [],
      roundIndex: 1,
      results: [],
      phase: 'guessing' as const,
    }
    saveState('usa', sample({ current: game })) // the official daily in progress
    saveState('usa__shuffle', sample({ current: game })) // a previous shuffle game
    expect(applyStartupReset('usa__shuffle')).toBe(true)
    expect(loadState('usa').current).toEqual(game) // daily preserved
    // The shuffle scratch is wiped entirely (each load is a new lineup, so its
    // history would otherwise grow forever).
    expect(loadState('usa__shuffle')).toEqual(defaultState())
  })

  it('returns false (clears nothing) when no active namespace is known', () => {
    vi.stubGlobal('window', { location: { search: '?reset' } })
    saveState('usa', sample())
    expect(applyStartupReset(null)).toBe(false)
    expect(loadState('usa')).not.toEqual(defaultState())
  })
})
