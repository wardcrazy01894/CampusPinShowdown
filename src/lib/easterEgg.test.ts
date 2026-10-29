import { describe, it, expect } from 'vitest'
import { revealTag } from './easterEgg'

describe('revealTag (〽️ easter egg)', () => {
  it('tags Ann Arbor with Go Blue', () => {
    expect(revealTag({ id: 'ann-arbor-mi' })).toBe('〽️ Go Blue!')
  })

  it('tags nothing else — not even the other Michigan towns', () => {
    for (const id of [
      'east-lansing-mi',
      'kalamazoo-mi',
      'columbus-oh',
      'athens-ga',
    ]) {
      expect(revealTag({ id }), id).toBeNull()
    }
  })
})
