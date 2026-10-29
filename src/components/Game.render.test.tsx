// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { Game } from './Game'
import { REGION } from '../lib/region'
import { saveState, STORAGE_VERSION } from '../lib/storage'
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
    schools: ['Carleton College', 'St. Olaf College'],
    lat: 44.45,
    lng: -93.16,
    difficulty: 'hard',
    source: 'manual',
    attribution: 't',
  },
]

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('Game', () => {
  it('asks for the SCHOOL and withholds the town and state until the guess is in', () => {
    render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
      />,
    )
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Where is University of Michigan?',
    ) // no town, no state, no 〽️ before the reveal — none may be a hint
    expect(screen.queryByText(/Ann Arbor/)).toBeNull()
    // The state would appear as ", Michigan" after the town — never before.
    expect(screen.queryByText(/, Michigan/)).toBeNull()
    expect(screen.getByText('Pin the town it calls home.')).toBeTruthy()
    // The tier is shown up front as an expectation-setter (town-independent).
    expect(screen.getByText('🟢 Easy')).toBeTruthy()
    expect(
      (
        screen.getByRole('button', {
          name: 'Submit guess',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('resumes a saved revealed round and shows the state + distance', () => {
    saveState('usa', {
      version: STORAGE_VERSION,
      history: [],
      streak: { current: 0, best: 0, lastPlayedDateKey: null },
      current: {
        dateKey: '2026-10-29',
        towns,
        roundIndex: 0,
        results: [
          {
            town: towns[0],
            guess: { lat: 42, lng: -84 },
            distanceMeters: 40_000,
            score: 96,
          },
        ],
        phase: 'revealed',
      },
    })
    render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
      />,
    )
    // The town (and the 〽️ egg) appear only now, after the reveal.
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Ann Arbor, Michigan〽️ Go Blue!',
    )
    expect(screen.getByText('Home of University of Michigan')).toBeTruthy()
    expect(screen.getByText('25 mi')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next round' })).toBeTruthy()
  })

  it('renders Results for a finished saved game', () => {
    saveState('usa', {
      version: STORAGE_VERSION,
      history: [],
      streak: { current: 3, best: 5, lastPlayedDateKey: '2026-10-29' },
      current: {
        dateKey: '2026-10-29',
        towns,
        roundIndex: 1,
        results: towns.map((t) => ({
          town: t,
          guess: { lat: t.lat, lng: t.lng },
          distanceMeters: 0,
          score: 100,
        })),
        phase: 'finished',
      },
    })
    render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
      />,
    )
    expect(screen.getByText(/Done for today!/)).toBeTruthy()
    expect(screen.getByText(/Streak 3 \(best 5\)/)).toBeTruthy()
    // Each results row carries its tier so a miss on a 🔴 reads fairly.
    expect(screen.getByText('🟢 Easy')).toBeTruthy()
    expect(screen.getByText('🔴 Hard')).toBeTruthy()
  })
})

describe('Game — resume mid-reveal restores the pin', () => {
  it('frames guess + truth + line (not the truth alone) when reloaded after submit', () => {
    saveState('usa', {
      version: STORAGE_VERSION,
      history: [],
      streak: { current: 0, best: 0, lastPlayedDateKey: null },
      current: {
        dateKey: '2026-10-29',
        towns,
        roundIndex: 0,
        results: [
          {
            town: towns[0],
            guess: { lat: 40, lng: -90 },
            distanceMeters: 600_000,
            score: 19,
          },
        ],
        phase: 'revealed',
      },
    })
    const { container } = render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
      />,
    )
    // Truth marker + guess marker + dashed line = three SVG paths. Without the
    // restored pin there would be only the truth marker.
    expect(
      container.querySelectorAll('.leaflet-overlay-pane path'),
    ).toHaveLength(3)
  })
})

describe('Game — reports its phase to the parent', () => {
  it('calls onPhaseChange with the saved phase on mount', () => {
    saveState('usa', {
      version: STORAGE_VERSION,
      history: [],
      streak: { current: 0, best: 0, lastPlayedDateKey: null },
      current: {
        dateKey: '2026-10-29',
        towns,
        roundIndex: 1,
        results: towns.map((t) => ({
          town: t,
          guess: { lat: t.lat, lng: t.lng },
          distanceMeters: 900_000,
          score: 8,
        })),
        phase: 'finished',
      },
    })
    const seen: string[] = []
    render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
        onPhaseChange={(p) => seen.push(p)}
      />,
    )
    expect(seen).toEqual(['finished'])
  })

  it('reports guessing for a fresh day', () => {
    const seen: string[] = []
    render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
        onPhaseChange={(p) => seen.push(p)}
      />,
    )
    expect(seen).toEqual(['guessing'])
  })
})
