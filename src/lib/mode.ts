/**
 * Resolve the play mode from the URL query params into a {@link Mode}: the real
 * daily, a `?shuffle` random set, or a `?date=` override. Pure (takes `search`,
 * `now`, a shuffle seed, and an optional timezone) so it's unit-testable
 * without the DOM — see mode.test.ts.
 *
 * Storage isolation: ONLY the official daily writes the real save
 * (`storageId === REGION.id`). Every non-official mode gets its own namespace so
 * finishing it can't bump the real streak, append to real history, or clobber
 * an in-progress daily.
 */

import { getDateKey, isValidDateKey } from './daily'
import { shouldShuffle } from './devmode'
import { shouldDeferReload } from './version'
import { REGION } from './region'
import type { GameState } from '../types'

/** Namespace suffix for the ?shuffle scratch save — shared with storage.ts so
 *  the two can't drift. */
export const SHUFFLE_SUFFIX = '__shuffle'

export interface Mode {
  dateKey: string
  /** Seed for selectDailyTowns — region + date (or a per-load random for shuffle). */
  selectionSeed: string
  /** Short human label for the header ("2026-10-29", "shuffle", "… (override)"). */
  label: string
  /** True ONLY for the real daily challenge (today's date-seeded 5). */
  official: boolean
  /**
   * localStorage namespace for Game. Equals `REGION.id` ONLY for the official
   * daily; non-official modes use an isolated suffix so they never touch the
   * real save.
   */
  storageId: string
}

export function resolveMode(
  search: string,
  now: Date,
  shuffleSeed: string,
  timeZone?: string,
): Mode {
  const today = getDateKey(now, timeZone)
  if (shouldShuffle(search)) {
    return {
      dateKey: today,
      selectionSeed: `${REGION.id}:shuffle-${shuffleSeed}`,
      label: 'shuffle — random 5 (refresh for a new set)',
      official: false,
      storageId: `${REGION.id}${SHUFFLE_SUFFIX}`,
    }
  }
  const param = new URLSearchParams(search).get('date')
  if (param && isValidDateKey(param)) {
    return {
      dateKey: param,
      selectionSeed: `${REGION.id}:${param}`,
      label: `${param} (override)`,
      official: false,
      storageId: `${REGION.id}__date`,
    }
  }
  return {
    dateKey: today,
    selectionSeed: `${REGION.id}:${today}`,
    label: today,
    official: true,
    storageId: REGION.id,
  }
}

/**
 * Which mode a mounted OFFICIAL session should keep rendering when a re-render
 * recomputes `resolveMode` with a fresh clock. The official selectionSeed embeds
 * the date, so the first re-render after midnight would otherwise remount
 * <Game> and yank the player into the new day — losing a mid-round guess, or
 * pulling them off a finished day's results without a click. Day-advance is the
 * player's call (the same rule the auto-reload path follows — shouldDeferReload
 * in version.ts), so:
 *
 *  - freeze on `prev` when the seed changed under an official session AND
 *    adopting `next` would disturb a saved game (mid-round, or any game for a
 *    day other than next's today);
 *  - otherwise pass `next` through (first render, same seed, non-official
 *    modes — their seeds don't roll at midnight anyway).
 *
 * `getSaved` is a thunk so the storage read only happens on an actual rollover.
 */
export function resolveSessionMode(
  prev: Mode | null,
  next: Mode,
  getSaved: () => GameState | undefined,
): Mode {
  if (!prev || !next.official || !prev.official) return next
  if (prev.storageId !== next.storageId) return next
  if (prev.selectionSeed === next.selectionSeed) return prev
  return shouldDeferReload(getSaved(), next.dateKey) ? prev : next
}
