/**
 * localStorage persistence for streaks, history, and resume-in-progress.
 *
 * VERSIONING: bump STORAGE_VERSION whenever the persisted shape changes.
 * `loadState` MUST tolerate older/missing/corrupt data by returning a fresh
 * default rather than throwing — otherwise a schema change bricks returning
 * players. Treat any parse error or version mismatch as "no saved data".
 */

import type { DayRecord, GameState } from '../types'
import type { Streak } from './progress'
import { log } from './log'
import { shouldStartFresh } from './devmode'

export const STORAGE_VERSION = 1
const PREFIX = 'cps:v' + STORAGE_VERSION
/** Streak/history/resume are per mode namespace (official daily vs. the isolated
 *  ?shuffle / ?date scratch spaces — see mode.ts), so the key carries that id. */
const keyFor = (storageId: string) => `${PREFIX}:${storageId}`

export interface PersistedState {
  version: number
  /**
   * Today's game — in progress OR finished. A finished game STAYS here (Game
   * persists `phase: 'finished'`): the results screen re-shows on reload, and
   * both the midnight-rollover freeze (mode.ts:resolveSessionMode) and the
   * auto-reload deferral (version.ts:shouldDeferReload) read it to decide
   * whether a day-advance would disturb the player. Never clear it on finish.
   */
  current?: GameState
  /** Completed days, newest last. */
  history: DayRecord[]
  streak: Streak
}

/** Returns persisted state for a namespace, or a fresh default on miss/corruption. */
export function loadState(storageId: string): PersistedState {
  try {
    const raw = localStorage.getItem(keyFor(storageId))
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw) as Partial<PersistedState> | null
    if (parsed?.version !== STORAGE_VERSION) {
      log.warn('storage', 'version mismatch — resetting saved state', {
        found: parsed?.version,
        expected: STORAGE_VERSION,
      })
      return defaultState()
    }
    // Shape check: a hand-edited or partially-written value with the right
    // version but no `history`/`streak` would otherwise throw deep inside
    // recordCompletion on game completion. Treat it as corrupt.
    if (
      !Array.isArray(parsed.history) ||
      typeof parsed.streak !== 'object' ||
      parsed.streak === null ||
      (parsed.current != null && !Array.isArray(parsed.current.towns))
    ) {
      log.warn('storage', 'malformed saved state — resetting', {})
      return defaultState()
    }
    return parsed as PersistedState
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
 * Drop ONLY the current game from a namespace, keeping its history and streak.
 * This is what `?reset` needs: replay today's set from round 1 without
 * erasing a 30-day streak (which a whole-key wipe would). Best-effort.
 */
export function clearCurrent(storageId: string): void {
  const state = loadState(storageId)
  if (!state.current) return
  const { current: _dropped, ...rest } = state
  saveState(storageId, rest)
}

/**
 * Clears the in-progress/finished game on load when the URL asks for it
 * (`?reset`/`?fresh`/`?shuffle`) — see src/lib/devmode.ts. History and streak
 * are preserved. Default loads persist. Returns true if it cleared. Call once
 * at startup, before any component reads state.
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
  // ?shuffle gets a brand-new lineup every load, so each finished shuffle game
  // would append its own DayRecord forever — wipe that scratch namespace
  // entirely. Everything else (the official daily under ?reset) keeps its
  // history + streak and drops only the current game.
  if (storageId.endsWith('__shuffle')) clearState(storageId)
  else clearCurrent(storageId)
  log.info('storage', 'startup reset: cleared current game', { storageId })
  return true
}
