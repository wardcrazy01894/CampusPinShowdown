import { describe, it, expect } from 'vitest'
import {
  haversineMeters,
  scoreForDistance,
  scoreGuess,
  formatDistance,
  metersToMiles,
  totalScore,
  scoreEmoji,
  HINT_PENALTY,
  applyHintPenalty,
  perfectEmoji,
  PERFECT_EMOJIS,
  MAX_ROUND_SCORE,
  PERFECT_RADIUS_M,
  DECAY_M,
} from './scoring'
import type { Town } from '../types'

const annArbor: Town = {
  id: 'ann-arbor-mi',
  name: 'Ann Arbor',
  state: 'Michigan',
  stateCode: 'MI',
  schools: ['University of Michigan'],
  lat: 42.2808,
  lng: -83.743,
  difficulty: 'easy',
  source: 'manual',
  attribution: 'test',
}

describe('haversineMeters', () => {
  it('is ~0 for identical points', () => {
    expect(haversineMeters(annArbor, annArbor)).toBeCloseTo(0, 5)
  })

  it('matches a known distance (Ann Arbor ↔ East Lansing ≈ 49 mi as the crow flies)', () => {
    const d = haversineMeters(annArbor, { lat: 42.7369, lng: -84.4839 })
    expect(metersToMiles(d)).toBeGreaterThan(45)
    expect(metersToMiles(d)).toBeLessThan(55)
  })

  it('one degree of latitude ≈ 111 km', () => {
    const d = haversineMeters({ lat: 40, lng: -90 }, { lat: 41, lng: -90 })
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })
})

describe('scoreForDistance', () => {
  it('awards full points within the perfect radius', () => {
    expect(scoreForDistance(0)).toBe(MAX_ROUND_SCORE)
    expect(scoreForDistance(PERFECT_RADIUS_M)).toBe(MAX_ROUND_SCORE)
  })

  it('drops below full just past the perfect radius', () => {
    expect(scoreForDistance(PERFECT_RADIUS_M + 5_000)).toBeLessThan(
      MAX_ROUND_SCORE,
    )
  })

  it('decays exponentially: one decay length past the radius ≈ 37', () => {
    expect(scoreForDistance(PERFECT_RADIUS_M + DECAY_M)).toBe(37)
  })

  it('hits every documented anchor point (the table in scoring.ts)', () => {
    const table: Array<[number, number]> = [
      [50_000, 93],
      [100_000, 81],
      [200_000, 61],
      [300_000, 46],
      [500_000, 26],
      [800_000, 11],
      [1_000_000, 6],
      [1_500_000, 1],
    ]
    for (const [m, s] of table) expect(scoreForDistance(m), `${m} m`).toBe(s)
  })

  it('reaches exactly 0 for a cross-country miss', () => {
    expect(scoreForDistance(3_000_000)).toBe(0)
  })

  it('decreases monotonically and stays within [0, MAX]', () => {
    let prev = MAX_ROUND_SCORE + 1
    for (const d of [
      0, 10_000, 30_000, 100_000, 400_000, 900_000, 2_000_000, 5_000_000,
    ]) {
      const s = scoreForDistance(d)
      expect(s).toBeLessThanOrEqual(prev)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(MAX_ROUND_SCORE)
      prev = s
    }
  })
})

describe('scoreGuess', () => {
  it('scores a pin on the town as perfect', () => {
    const r = scoreGuess(annArbor, { lat: 42.29, lng: -83.75 })
    expect(r.score).toBe(MAX_ROUND_SCORE)
    expect(r.distanceMeters).toBeLessThan(PERFECT_RADIUS_M)
  })

  it('scores a pin in the wrong state as a partial', () => {
    // Columbus, OH — ~160 mi from Ann Arbor.
    const r = scoreGuess(annArbor, { lat: 39.9612, lng: -82.9988 })
    expect(r.score).toBeGreaterThan(40)
    expect(r.score).toBeLessThan(60)
  })

  it('scores a pin across the country as 0', () => {
    // Eugene, OR
    const r = scoreGuess(annArbor, { lat: 44.0521, lng: -123.0868 })
    expect(r.score).toBe(0)
  })

  it('deducts HINT_PENALTY when the state was revealed, floored at 0', () => {
    const perfect = scoreGuess(
      annArbor,
      { lat: 42.29, lng: -83.75 },
      {
        hinted: true,
      },
    )
    expect(perfect.score).toBe(MAX_ROUND_SCORE - HINT_PENALTY) // 75: never green
    expect(perfect.score).toBeLessThan(80)
    const miss = scoreGuess(
      annArbor,
      { lat: 44.0521, lng: -123.0868 },
      {
        hinted: true,
      },
    )
    expect(miss.score).toBe(0)
    // Explicit false and omitted both mean no penalty.
    expect(
      scoreGuess(annArbor, { lat: 42.29, lng: -83.75 }, { hinted: false })
        .score,
    ).toBe(MAX_ROUND_SCORE)
  })
})

describe('applyHintPenalty', () => {
  it('is HINT_PENALTY (25) off, floored at zero, and a no-op without a hint', () => {
    expect(HINT_PENALTY).toBe(25)
    expect(applyHintPenalty(100, true)).toBe(75)
    expect(applyHintPenalty(10, true)).toBe(0)
    expect(applyHintPenalty(55, false)).toBe(55)
  })
})

describe('totalScore', () => {
  it('sums round scores (0 for no rounds)', () => {
    expect(totalScore([])).toBe(0)
    expect(totalScore([{ score: 100 }, { score: 37 }, { score: 0 }])).toBe(137)
  })
})

describe('formatDistance (miles)', () => {
  it('shows one decimal under 10 miles', () => {
    expect(formatDistance(1609.344 * 3.44)).toBe('3.4 mi')
    expect(formatDistance(0)).toBe('0.0 mi')
  })

  it('shows whole miles at 10+ with thousands separators', () => {
    expect(formatDistance(1609.344 * 142.4)).toBe('142 mi')
    expect(formatDistance(1609.344 * 2345.6)).toBe('2,346 mi')
  })
})

describe('perfectEmoji', () => {
  it('rotates through the list by puzzle number, starting at 💯 on #1', () => {
    expect(perfectEmoji('2026-10-29')).toBe('💯') // puzzle #1
    expect(perfectEmoji('2026-10-30')).toBe('🏆') // #2
    expect(perfectEmoji('2026-10-31')).toBe('〽️') // #3 — Go Blue
    expect(perfectEmoji('2026-11-04')).toBe('💯') // #7 wraps
    // Same day → same emoji for everyone's share card.
    expect(perfectEmoji('2026-11-02')).toBe(perfectEmoji('2026-11-02'))
  })
  it('every entry is one glyph (plus an optional variation selector), so the share bar stays one per round', () => {
    // 〽️ is U+303D + U+FE0F; everything else is a single code point.
    for (const e of PERFECT_EMOJIS)
      expect([...e.replace(/\uFE0F/g, '')]).toHaveLength(1)
  })
})

describe('scoreEmoji', () => {
  it('gives a perfect 100 the day’s special emoji when a date is given', () => {
    expect(scoreEmoji(100, '2026-10-29')).toBe('💯')
    expect(scoreEmoji(100, '2026-10-30')).toBe('🏆')
    expect(scoreEmoji(99, '2026-10-30')).toBe('🟩') // only a true 100
  })
  it('maps scores to tiers', () => {
    expect(scoreEmoji(100)).toBe('🟩')
    expect(scoreEmoji(80)).toBe('🟩')
    expect(scoreEmoji(79)).toBe('🟨')
    expect(scoreEmoji(50)).toBe('🟨')
    expect(scoreEmoji(49)).toBe('🟧')
    expect(scoreEmoji(20)).toBe('🟧')
    expect(scoreEmoji(19)).toBe('⬛')
    expect(scoreEmoji(0)).toBe('⬛')
  })
})
