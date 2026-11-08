// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react'
import { Game } from './Game'
import { REGION } from '../lib/region'
import { saveState, loadState, STORAGE_VERSION } from '../lib/storage'
import { resetSchoolFactsCache } from '../lib/schoolFacts'
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
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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
    // Results says "Done for today!" only while the saved game's dateKey is
    // the CURRENT day, so pin the clock (Date only — timers stay real for
    // React Testing Library). A bare hardcoded date was a time bomb: this
    // test broke on its own the morning after it was written.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-29T12:00:00') })
    const today = '2026-10-29'
    saveState('usa', {
      version: STORAGE_VERSION,
      history: [],
      streak: { current: 3, best: 5, lastPlayedDateKey: today },
      current: {
        dateKey: today,
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
        dateKey={today}
        bounds={REGION.bounds}
        towns={towns}
        official
        basemap="satellite"
        onBasemapChange={() => {}}
      />,
    )
    expect(screen.getByText(/Done for today!/)).toBeTruthy()
    // The recap map carries the same worded basemap button as the play map.
    expect(
      screen
        .getByRole('button', { name: /night lights/i })
        .closest('.map-wrap'),
    ).toBeTruthy()
    expect(screen.getByText(/Streak 3 \(best 5\)/)).toBeTruthy()
    // Each results row carries its tier so a miss on a 🔴 reads fairly.
    expect(screen.getByText('🟢 Easy')).toBeTruthy()
    expect(screen.getByText('🔴 Hard')).toBeTruthy()
  })
})

describe('Game — hint mode', () => {
  it('offers the REGION for a penalty before the guess, never shows it unasked', () => {
    render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
      />,
    )
    const hint = screen.getByRole('button', {
      name: '💡 Reveal the region (−25 pts)',
    })
    expect(screen.queryByText(/It’s in/)).toBeNull()
    fireEvent.click(hint)
    // The REGION (a group of states), never the one state by itself.
    expect(
      screen.getByText(/💡 It’s in the Great Lakes \(OH, MI, IN, IL, WI\)/),
    ).toBeTruthy()
    expect(screen.queryByText(/, Michigan/)).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Reveal the region/ }),
    ).toBeNull()
    // Still no town, and the hint is persisted for a reload.
    expect(screen.queryByText(/Ann Arbor/)).toBeNull()
    expect(loadState('usa').current?.hintUsed).toBe(true)
  })

  it('keeps the hint revealed on reload and marks the result after a hinted submit', () => {
    saveState('usa', {
      version: STORAGE_VERSION,
      history: [],
      streak: { current: 0, best: 0, lastPlayedDateKey: null },
      current: {
        dateKey: '2026-10-29',
        towns,
        roundIndex: 0,
        results: [],
        phase: 'guessing',
        hintUsed: true,
      },
    })
    const { unmount } = render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
      />,
    )
    expect(screen.getByText(/It’s in the Great Lakes/)).toBeTruthy()
    unmount()
    // A revealed hinted round shows the deduction next to the score.
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
            guess: { lat: 42.29, lng: -83.75 },
            distanceMeters: 1_000,
            score: 75,
            hinted: true,
          },
        ],
        phase: 'revealed',
        hintUsed: true,
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
    expect(screen.getByText(/💡 hint used \(−25\)/)).toBeTruthy()
    expect(screen.getByText('75')).toBeTruthy()
  })
})

describe('Game — day records carry per-round tier', () => {
  it('writes each round’s difficulty into the history record on finish', () => {
    saveState('usa', {
      version: STORAGE_VERSION,
      history: [],
      streak: { current: 0, best: 0, lastPlayedDateKey: null },
      current: {
        dateKey: '2026-10-29',
        towns,
        roundIndex: 1,
        results: [
          {
            town: towns[0],
            guess: { lat: 42.28, lng: -83.74 },
            distanceMeters: 0,
            score: 100,
          },
          {
            town: towns[1],
            guess: { lat: 44.45, lng: -93.16 },
            distanceMeters: 0,
            score: 75,
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
    fireEvent.click(screen.getByRole('button', { name: 'See results' }))
    const rec = loadState('usa').history[0]
    expect(rec.results).toEqual([
      { distanceMeters: 0, score: 100, difficulty: 'easy' },
      { distanceMeters: 0, score: 75, difficulty: 'hard' },
    ])
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

describe('Game — play layout (map fills the screen, chrome floats)', () => {
  // The CSS turns `section.play` into a full-height box with the map
  // underneath and the prompt / action bars floating over it. That only
  // works if the DOM has this exact shape, so pin it here (jsdom has no
  // layout — this is the structure the stylesheet depends on).
  it('puts the prompt and the actions in their own bars beside the map', () => {
    const { container } = render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
      />,
    )
    const play = container.querySelector('section.play') as HTMLElement
    expect(play).toBeTruthy()
    const prompt = play.querySelector(':scope > .play__prompt') as HTMLElement
    const map = play.querySelector(':scope > .map-wrap')
    const actions = play.querySelector(':scope > .play__actions') as HTMLElement
    expect(prompt && map && actions).toBeTruthy()
    // Prompt bar: round line, the question, the hint offer, the helper line.
    expect(prompt.querySelector('h2')?.textContent).toBe(
      'Where is University of Michigan?',
    )
    expect(prompt.textContent).toContain('Round 1 of 2')
    expect(prompt.querySelector('.play__help')?.textContent).toBe(
      'Tap the map where you think it is, then submit.',
    )
    // Action bar: the Submit button, and nothing else before a reveal.
    expect(actions.querySelector('button')?.textContent).toBe('Submit guess')
    expect(actions.querySelectorAll('button')).toHaveLength(1)
  })

  it('shows the distance + Next in the action bar after a reveal', () => {
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
    const { container } = render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
      />,
    )
    const actions = container.querySelector(
      'section.play > .play__actions',
    ) as HTMLElement
    expect(actions.textContent).toContain('25 mi')
    expect(actions.textContent).toContain('96')
    expect(actions.querySelector('button')?.textContent).toBe('Next round')
  })
})

describe('Game — school card', () => {
  const file = {
    version: 1,
    generated: '2026-11-08',
    attribution: 'Wikipedia',
    rankingEdition: 2026,
    schools: [
      {
        school: 'University of Michigan',
        wikipedia: 'University of Michigan',
        funFact:
          'The Big House is the largest stadium in the Western Hemisphere.',
        nickname: 'Wolverines',
        conference: 'Big Ten',
        division: 'NCAA Division I FBS',
      },
    ],
  }
  const revealedSave = () =>
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
  beforeEach(() => resetSchoolFactsCache())
  afterEach(() => vi.unstubAllGlobals())

  it('shows the prompt school’s card inside the prompt card after the reveal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => file })),
    )
    revealedSave()
    render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
      />,
    )
    await waitFor(() =>
      expect(
        screen.getByText(/largest stadium in the Western Hemisphere/),
      ).toBeTruthy(),
    )
    const card = screen.getByRole('complementary', {
      name: 'About University of Michigan',
    })
    expect(card.closest('.play__prompt')).not.toBeNull()
    expect(card.textContent).toContain('Wolverines · Big Ten · D-I FBS')
  })

  it('never shows or fetches the card while a round is open (it would name the town)', () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => file }))
    vi.stubGlobal('fetch', f)
    render(
      <Game
        storageId="usa"
        dateKey="2026-10-29"
        bounds={REGION.bounds}
        towns={towns}
        official
      />,
    )
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})
