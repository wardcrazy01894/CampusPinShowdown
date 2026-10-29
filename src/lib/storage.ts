/**
 * localStorage persistence for streaks, history, and resume-in-progress.
 *
 * VERSIONING: bump STORAGE_VERSION whenever the persisted shape changes.
 * `loadState` MUST tolerate older/missing/corrupt data by returning a fresh
 * default rather than throwing — otherwise a schema change bricks returning
 * players. Treat any parse error or version mismatch as "no saved data".
 */

import type { DayRecord, GameState } from '../types'
import { log } from './log'
import { shouldStartFresh } from './devmode'

export const STORAGE_VERSION = 1
const PREFIX = 'cps:v' + STORAGE_VERSION
/** Streak/history/resume are per mode namespace (official daily vs. the isolated
 *  ?shuffle / ?date scratch spaces — see mode.ts), so the key carries that id. */
const keyFor = (storageId: string) => `${PREFIX}:${storageId}`

export interface PersistedState {
  version: number
  /** In-progress game, if the player hasn't finished today. */
  current?: GameState
  /** Completed days, newest last. */
  history: DayRecord[]
  streak: { current: number; best: number; lastPlayedDateKey: string | null }
}

/** Returns persisted state for a namespace, or a fresh default on miss/corruption. */
export function loadState(storageId: string): PersistedState {
  try {
    const raw = localStorage.getItem(keyFor(storageId))
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw) as PersistedState
    if (parsed?.version !== STORAGE_VERSION) {
      log.warn('storage', 'version mismatch — resetting saved state', {
        found: parsed?.version,
        expected: STORAGE_VERSION,
      })
      return defaultState()
    }
    return parsed
  } catch (e) {
    // Corrupt JSON, disabled storage, etc. — never throw on read.
    log.warn('storage', 'load failed — using defaults', { error: String(e) })
    return defaultState()
  }
}

/** Persists a namespace's state. Swallow quota/serialization errors (best-effort). */
export function saveState(storageId: string, state: PersistedState): void {
  try {
    localStorage.setItem(keyFor(storageId), JSON.stringify(state))
  } catch (e) {
    // Quota exceeded / private mode — best-effort, ignore.
    log.warn('storage', 'save failed (quota/private mode?)', {
      error: String(e),
    })
  }
}

export function defaultState(): PersistedState {
  return {
    version: STORAGE_VERSION,
    history: [],
    streak: { current: 0, best: 0, lastPlayedDateKey: null },
  }
}

/**
 * Remove the persisted game state for ONE storage namespace (the official
 * daily, or an isolated mode namespace like `usa__shuffle`). Scoped on purpose:
 * a blanket wipe would also destroy the official daily when resetting a
 * non-official mode. Best-effort — never throws.
 */
export function clearState(storageId: string): void {
  try {
    localStorage.removeItem(keyFor(storageId))
  } catch (e) {
    log.warn('storage', 'clear failed', { error: String(e), storageId })
  }
}

/**
 * Clears saved progress on load when the URL asks for it (`?reset`/`?fresh`/
 * `?shuffle`) — see src/lib/devmode.ts. Default loads persist. Returns true if
 * it cleared. Call once at startup, before any component reads state.
 *
 * `storageId` is the ACTIVE mode's namespace (from resolveMode): `?reset`/
 * `?fresh` resolve to the official `usa` (replay today's set fresh), while
 * `?shuffle` resolves to `usa__shuffle` — so a shuffle reset clears only the
 * shuffle scratch and leaves the real in-progress daily intact. `null` clears
 * nothing.
 */
export function applyStartupReset(storageId: string | null): boolean {
  if (typeof window === 'undefined') return false
  if (!shouldStartFresh(window.location.search)) return false
  if (!storageId) return false
  clearState(storageId)
  log.info('storage', 'startup reset: cleared saved state', { storageId })
  return true
}
