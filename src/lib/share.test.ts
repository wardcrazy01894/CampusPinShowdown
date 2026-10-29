import { describe, it, expect } from 'vitest'
import { buildShareString } from './share'
import type { RoundResult, Town } from '../types'

function result(score: number, name: string): RoundResult {
  const town: Town = {
    id: name.toLowerCase(),
    name,
    state: 'Michigan',
    stateCode: 'MI',
    schools: ['U'],
    lat: 42,
    lng: -83,
    difficulty: 'easy',
    source: 'manual',
    attribution: 't',
  }
  return { town, guess: { lat: 0, lng: 0 }, distanceMeters: 0, score }
}

const results = [
  result(100, 'A'),
  result(85, 'B'),
  result(60, 'C'),
  result(30, 'D'),
  result(10, 'E'),
]

describe('buildShareString', () => {
  it('has the title with puzzle number, scored line, and an emoji bar', () => {
    const lines = buildShareString('2026-10-30', results, 285).split('\n')
    expect(lines[0]).toBe('📍 CampusPin Showdown #2')
    expect(lines[1]).toBe('2026-10-30 · 285/500')
    expect(lines[2]).toBe('🟩🟩🟨🟧⬛')
    expect(lines).toHaveLength(3)
  })

  it('has one emoji per round', () => {
    const bar = buildShareString('2026-10-30', results, 285).split('\n')[2]
    expect([...bar].length).toBe(results.length)
  })

  it('appends the site URL as the last line when given one', () => {
    const url = 'https://wardcrazy01894.github.io/CampusPinShowdown/'
    const lines = buildShareString('2026-10-30', results, 285, url).split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[3]).toBe(url)
  })
})
