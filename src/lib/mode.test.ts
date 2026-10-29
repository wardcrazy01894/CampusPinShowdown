import { describe, it, expect } from 'vitest'
import { resolveMode, resolveSessionMode } from './mode'
import type { GameState } from '../types'

// A fixed instant; Eastern puts this on 2026-10-29.
const NOW = new Date('2026-10-29T12:00:00Z')
const TZ = 'America/New_York'
const SEED = 'abc123'

describe('resolveMode', () => {
  it('normal mode is official and uses the real storage namespace', () => {
    const m = resolveMode('', NOW, SEED, TZ)
    expect(m.official).toBe(true)
    expect(m.storageId).toBe('usa')
    expect(m.dateKey).toBe('2026-10-29')
    expect(m.selectionSeed).toBe('usa:2026-10-29')
  })

  it('shuffle is NOT official and is isolated from the real daily save', () => {
    const m = resolveMode('?shuffle', NOW, SEED, TZ)
    expect(m.official).toBe(false)
    expect(m.storageId).toBe('usa__shuffle')
    expect(m.selectionSeed).toContain(SEED)
  })

  it('a ?date= override is NOT official and is isolated from the real daily save', () => {
    const m = resolveMode('?date=2026-12-25', NOW, SEED, TZ)
    expect(m.official).toBe(false)
    expect(m.dateKey).toBe('2026-12-25')
    expect(m.storageId).toBe('usa__date')
  })

  it('an invalid ?date= falls through to the official daily', () => {
    const m = resolveMode('?date=2026-99-99', NOW, SEED, TZ)
    expect(m.official).toBe(true)
    expect(m.dateKey).toBe('2026-10-29')
  })

  it('every non-official mode keeps its scores out of the real daily namespace', () => {
    for (const search of ['?shuffle', '?random', '?date=2026-01-15']) {
      const m = resolveMode(search, NOW, SEED, TZ)
      expect(m.official).toBe(false)
      expect(m.storageId).not.toBe('usa')
    }
  })
})

describe('resolveSessionMode — midnight rollover freeze', () => {
  const before = resolveMode('', new Date('2026-10-29T12:00:00Z'), SEED, TZ)
  const after = resolveMode('', new Date('2026-10-30T12:00:00Z'), SEED, TZ)
  const game = (over: Partial<GameState> = {}): GameState => ({
    dateKey: '2026-10-29',
    towns: [],
    roundIndex: 0,
    results: [],
    phase: 'guessing',
    ...over,
  })

  it('keeps the mounted day while a game is mid-round (never yank a guess)', () => {
    expect(resolveSessionMode(before, after, () => game())).toBe(before)
  })

  it('keeps the mounted day on a finished PAST day (leaving results is a click)', () => {
    expect(
      resolveSessionMode(before, after, () => game({ phase: 'finished' })),
    ).toBe(before)
  })

  it('adopts the new day when there is no saved game to disturb', () => {
    expect(resolveSessionMode(before, after, () => undefined)).toBe(after)
  })

  it('is a pass-through on first render / same seed', () => {
    expect(resolveSessionMode(null, after, () => game())).toBe(after)
    expect(resolveSessionMode(before, before, () => game())).toBe(before)
  })

  it('never freezes a non-official mode', () => {
    const shuffle = resolveMode(
      '?shuffle',
      new Date('2026-10-30T12:00:00Z'),
      SEED,
      TZ,
    )
    expect(resolveSessionMode(before, shuffle, () => game())).toBe(shuffle)
  })
})
