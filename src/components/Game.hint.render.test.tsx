// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

/**
 * The hinted-submit path end to end: hint → pin → submit → the SAVED flag
 * drives a real −25 (a near-perfect pin scores 75, not 100) → Next round
 * resets the hint. MapGuess is stubbed with a button that places the pin
 * ON the town: a jsdom click on the real Leaflet container lands ~15,000 km
 * away (score 0), where the penalty is invisible — which is exactly the
 * vacuous assertion the round-2 review caught.
 */
vi.mock('./MapGuess', () => ({
  MapGuess: ({
    onGuessChange,
    reveal,
  }: {
    onGuessChange: (g: { lat: number; lng: number }) => void
    reveal?: { town: { lat: number; lng: number } } | null
  }) => (
    <div data-testid="map-stub">
      <button
        type="button"
        onClick={() => onGuessChange({ lat: 42.28, lng: -83.74 })}
      >
        pin on Ann Arbor
      </button>
      {reveal ? <span>revealed</span> : null}
    </div>
  ),
}))

import { Game } from './Game'
import { REGION } from '../lib/region'
import { loadState } from '../lib/storage'
import { HINT_PENALTY, MAX_ROUND_SCORE } from '../lib/scoring'
import type { Town } from '../types'

const towns: Town[] = [
  {
    id: 'ann-arbor-mi',
    name: 'Ann Arbor',
    state: 'Michigan',
    stateCode: 'MI',
    schools: ['University of Michigan'],
    lat: 42.28,
    lng: -83.74,
    difficulty: 'easy',
    source: 'manual',
    attribution: 't',
  },
  {
    id: 'northfield-mn',
    name: 'Northfield',
    state: 'Minnesota',
    stateCode: 'MN',
    schools: ['Carleton College'],
    lat: 44.45,
    lng: -93.16,
    difficulty: 'hard',
    source: 'manual',
    attribution: 't',
  },
]

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('Game — hinted submit and advance', () => {
  it('applies −25 from the SAVED flag on submit, marks the result, and resets on Next round', () => {
    render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Reveal the region/ }))
    fireEvent.click(screen.getByRole('button', { name: 'pin on Ann Arbor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit guess' }))
    const r = loadState('usa').current!.results[0]
    expect(r.hinted).toBe(true)
    // A pin ON the town is a 100; the persisted hint makes it 75.
    expect(r.score).toBe(MAX_ROUND_SCORE - HINT_PENALTY)
    expect(screen.getByText('75')).toBeTruthy()
    expect(screen.getByText(/💡 hint used \(−25\)/)).toBeTruthy()
    // Next round: the hint is gone and the button is back.
    fireEvent.click(screen.getByRole('button', { name: 'Next round' }))
    expect(loadState('usa').current!.hintUsed).toBe(false)
    expect(
      screen.getByRole('button', { name: /Reveal the region/ }),
    ).toBeTruthy()
    expect(screen.queryByText(/It’s in/)).toBeNull()
  })

  it('an unhinted pin on the town is a clean 100 (the penalty is only ever from the flag)', () => {
    render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'pin on Ann Arbor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit guess' }))
    const r = loadState('usa').current!.results[0]
    expect(r.hinted).toBeUndefined()
    expect(r.score).toBe(MAX_ROUND_SCORE)
  })
})
