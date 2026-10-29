import { describe, it, expect } from 'vitest'
import { tierLabel, TIER_LABELS } from './tiers'
import { DIFFICULTY_PLAN } from './daily'

describe('tierLabel', () => {
  it('maps every difficulty to a coloured-dot label', () => {
    expect(tierLabel('easy')).toBe('🟢 Easy')
    expect(tierLabel('medium')).toBe('🟡 Medium')
    expect(tierLabel('hard')).toBe('🔴 Hard')
  })

  it('covers every difficulty the daily plan can hand out', () => {
    for (const d of DIFFICULTY_PLAN) {
      expect(Object.keys(TIER_LABELS)).toContain(d)
    }
  })

  // The label is shown BEFORE the guess, so it must never carry the answer:
  // no town, state or school text — only the tier word and its dot.
  it('is a fixed label per tier, independent of the town', () => {
    expect(tierLabel('easy')).toMatch(/^[^\w]+ Easy$/u)
    expect(tierLabel('hard')).toMatch(/^[^\w]+ Hard$/u)
  })
})
