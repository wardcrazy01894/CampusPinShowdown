import { describe, it, expect } from 'vitest'
import {
  haversineMeters,
  scoreForDistance,
  scoreGuess,
  formatDistance,
  metersToMiles,
  scoreEmoji,
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

  it('hits the documented anchor points (right metro / right state / wrong region)', () => {
    expect(scoreForDistance(100_000)).toBe(81)
    expect(scoreForDistance(300_000)).toBe(46)
    expect(scoreForDistance(500_000)).toBe(26)
    expect(scoreForDistance(1_000_000)).toBe(6)
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

describe('scoreEmoji', () => {
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
