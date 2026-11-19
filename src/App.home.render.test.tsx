// @vitest-environment jsdom
import { it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

/**
 * The brand (logo + title) is the way "home": today's game — the round in
 * play, or the results once the day is done. Owner report (2026-11-19):
 * "clicking on the logo [from the leaderboard] seems to do nothing".
 * The leaderboard's network calls are mocked; everything else is real.
 */

const { submitDailyScore, fetchLeaderboard } = vi.hoisted(() => ({
  submitDailyScore: vi.fn(async () => ({ rank: 2, total: 2 })),
  fetchLeaderboard: vi.fn(async () => ({ total: 2, scores: [400, 210] })),
}))
vi.mock('./lib/leaderboard', async (importActual) => ({
  ...(await importActual<typeof import('./lib/leaderboard')>()),
  submitDailyScore,
  fetchLeaderboard,
}))

import { App } from './App'
import { dailyLineup, getDateKey } from './lib/daily'
import { saveState, STORAGE_VERSION } from './lib/storage'
import type { Town, TownsFile } from './types'

const town = (
  name: string,
  st: string,
  difficulty: Town['difficulty'],
): Town => ({
  id: `${name.toLowerCase().replace(/\s+/g, '-')}-${st.toLowerCase()}`,
  name,
  state: st,
  stateCode: st,
  schools: [`University of ${name}`],
  lat: 40,
  lng: -90,
  difficulty,
  source: 'manual',
  attribution: 't',
})

const FILE: TownsFile = {
  version: 1,
  region: 'usa',
  attribution: 'Town coordinates © test',
  towns: [
    town('Ann Arbor', 'MI', 'easy'),
    town('Athens', 'GA', 'easy'),
    town('Boulder', 'CO', 'easy'),
    town('Oxford', 'OH', 'medium'),
    town('Boone', 'NC', 'medium'),
    town('Gambier', 'OH', 'hard'),
    town('Grinnell', 'IA', 'hard'),
  ],
}

let scrollTo: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => FILE })),
  )
  scrollTo = vi.fn()
  vi.stubGlobal('scrollTo', scrollTo)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** Save today's game as finished (modest scores: no confetti in jsdom). */
function finishToday() {
  const today = getDateKey(new Date())
  const towns = dailyLineup(FILE.towns, 'usa', today)
  saveState('usa', {
    version: STORAGE_VERSION,
    history: [],
    streak: { current: 1, best: 1, lastPlayedDateKey: today },
    current: {
      dateKey: today,
      towns,
      roundIndex: 4,
      results: towns.map((t) => ({
        town: t,
        guess: { lat: t.lat + 3, lng: t.lng },
        distanceMeters: 330_000,
        score: 42,
      })),
      phase: 'finished',
    },
  })
}

const home = () =>
  screen.getByRole('link', { name: 'CampusPin Showdown — home' })

it('the brand takes you from the leaderboard back to the results', async () => {
  finishToday()
  render(<App />)
  await screen.findByText(/Done for today!/)
  fireEvent.click(await screen.findByRole('button', { name: /2nd of 2/ }))
  expect(await screen.findByText(/🏆 Leaderboard/)).toBeTruthy()
  expect(screen.queryByText(/Done for today!/)).toBeNull()

  fireEvent.click(home())
  expect(screen.getByText(/Done for today!/)).toBeTruthy()
  expect(screen.queryByText(/🏆 Leaderboard/)).toBeNull()
  expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
})

it('the brand is a real link to the site root, on the title and on the logo', async () => {
  render(<App />)
  await screen.findByText(/Round 1 of 5/)
  const link = home()
  expect(link.getAttribute('href')).toBe(import.meta.env.BASE_URL)
  // The title stays the page's h1; the link lives inside it.
  expect(link.closest('h1')).toBeTruthy()
  // The logo mark is a second, pointer-only way to the same place.
  const mark = document.querySelector('a.brand__mark') as HTMLAnchorElement
  expect(mark.getAttribute('href')).toBe(import.meta.env.BASE_URL)
  expect(mark.getAttribute('aria-hidden')).toBe('true')
  expect(mark.tabIndex).toBe(-1)
})

it('mid-round, going home keeps the round and never reloads the page', async () => {
  render(<App />)
  await screen.findByText(/Round 1 of 5/)
  const question = screen.getByRole('heading', { level: 2 }).textContent
  // fireEvent returns false when the handler called preventDefault — the
  // click must not navigate (a reload would reshuffle a ?shuffle game).
  expect(fireEvent.click(home())).toBe(false)
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(question)
})

it('leaves a modified click alone so the game can open in a new tab', async () => {
  render(<App />)
  await screen.findByText(/Round 1 of 5/)
  expect(fireEvent.click(home(), { metaKey: true })).toBe(true)
  expect(scrollTo).not.toHaveBeenCalled()
})

it('closes an open overlay, from the logo mark as well as the title', async () => {
  render(<App />)
  await screen.findByText(/Round 1 of 5/)
  fireEvent.click(
    screen.getByRole('button', { name: /is my school in the game/ }),
  )
  expect(screen.getByLabelText('Search schools')).toBeTruthy()
  fireEvent.click(home())
  expect(screen.queryByLabelText('Search schools')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: /report a bug/ }))
  expect(screen.getByRole('heading', { name: '🐛 Report a bug' })).toBeTruthy()
  fireEvent.click(document.querySelector('a.brand__mark')!)
  expect(screen.queryByRole('heading', { name: '🐛 Report a bug' })).toBeNull()
})

it('going home frames the whole day on the recap map again', async () => {
  finishToday()
  render(<App />)
  await screen.findByText(/Done for today!/)
  const row = screen.getAllByRole('button', { pressed: false })[0]
  fireEvent.click(row)
  expect(row.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(home())
  expect(row.getAttribute('aria-pressed')).toBe('false')
})

it('jumps rather than glides to the top for players who asked for less motion', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({ matches: q.includes('prefers-reduced-motion') })),
  )
  render(<App />)
  await screen.findByText(/Round 1 of 5/)
  fireEvent.click(home())
  expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
})
