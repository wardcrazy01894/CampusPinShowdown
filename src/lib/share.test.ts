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
    expect(lines[2]).toBe('🏆🟩🟨🟧⬛') // puzzle #2 → a 100 shows as 🏆
    expect(lines).toHaveLength(3)
  })

  it('adds a 💡 line when any round used a hint, and none otherwise', () => {
    const hinted = results.map((r, i) =>
      i === 1 || i === 3 ? { ...r, hinted: true } : r,
    )
    const lines = buildShareString('2026-10-30', hinted, 235, 'https://x/')
    expect(lines.split('\n')).toEqual([
      '📍 CampusPin Showdown #2',
      '2026-10-30 · 235/500',
      expect.any(String),
      '💡 2 hints',
      'https://x/',
    ])
    const one = results.map((r, i) => (i === 0 ? { ...r, hinted: true } : r))
    expect(buildShareString('2026-10-30', one, 260)).toMatch(/\n💡 1 hint$/)
    expect(buildShareString('2026-10-30', results, 285)).not.toMatch(/💡/)
  })

  it('has one emoji per round', () => {
    const bar = buildShareString('2026-10-30', results, 285).split('\n')[2]
    // Strip variation selectors (〽️ = U+303D U+FE0F) before counting glyphs.
    expect([...bar.replace(/\uFE0F/g, '')]).toHaveLength(results.length)
  })

  it('appends the site URL as the last line when given one', () => {
    const url = 'https://wardcrazy01894.github.io/CampusPinShowdown/'
    const lines = buildShareString('2026-10-30', results, 285, url).split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[3]).toBe(url)
  })
})
