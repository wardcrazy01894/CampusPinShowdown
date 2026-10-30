// @vitest-environment jsdom
import { promptSchool } from './lib/schools'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react'
import { App, OVERLAY_Z_INDEX } from './App'
import type { Town, TownsFile } from './types'

const town = (
  name: string,
  st: string,
  state: string,
  difficulty: Town['difficulty'],
): Town => ({
  id: `${name.toLowerCase().replace(/\s+/g, '-')}-${st.toLowerCase()}`,
  name,
  state,
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
    town('Ann Arbor', 'MI', 'Michigan', 'easy'),
    town('Athens', 'GA', 'Georgia', 'easy'),
    town('Boulder', 'CO', 'Colorado', 'easy'),
    town('Oxford', 'OH', 'Ohio', 'medium'),
    town('Boone', 'NC', 'North Carolina', 'medium'),
    town('Gambier', 'OH', 'Ohio', 'hard'),
    town('Grinnell', 'IA', 'Iowa', 'hard'),
  ],
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => FILE })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('loads the dataset and starts round 1 with the state withheld', async () => {
    render(<App />)
    expect(await screen.findByText(/Round 1 of 5/)).toBeTruthy()
    const h2 = screen.getByRole('heading', { level: 2 })
    expect(h2.textContent).toMatch(/^Where is University of [A-Za-z ]+\?$/)
    // The prompt is the school; neither the town nor the state may show.
    for (const t of FILE.towns) {
      expect(h2.textContent).not.toContain(t.state)
      expect(h2.textContent).not.toContain(`is ${t.name}?`)
    }
  })

  it('credits the idea in the footer and shows the map attribution', async () => {
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    expect(
      screen.getByText('Idea courtesy of good friend Garret B.'),
    ).toBeTruthy()
    // Mid-round the town search is hidden — it would answer the round.
    expect(
      screen.queryByRole('button', { name: /is my town in the game/ }),
    ).toBeNull()
    expect(screen.getByText(/Town coordinates © test/)).toBeTruthy()
    // (Leaflet's own attribution control renders a second NASA GIBS link.)
    expect(
      screen.getAllByRole('link', { name: 'NASA GIBS' }).length,
    ).toBeGreaterThan(0)
  })

  it('shows a failure message when the dataset cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    )
    render(<App />)
    expect(await screen.findByText(/Failed to load/)).toBeTruthy()
  })
})

describe('App — seed change never shows the previous seed’s towns', () => {
  // Review finding on PR #2: picks were set in an effect, but <Game> is keyed
  // on the seed and remounted on the render BEFORE that effect ran, so a
  // rollover (or ?date change) mounted the new day with the OLD towns baked
  // into Game's state. The seed is driven by ?date= here; a midnight rollover
  // takes the same path through resolveMode → selectionSeed.
  it('mounts the new day with the new day’s towns on the same render', async () => {
    const { selectDailyTowns } = await import('./lib/daily')
    window.history.replaceState({}, '', '/?date=2026-11-01')
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    const day1 = selectDailyTowns(FILE.towns, 'usa:2026-11-01')[0]
    const day2 = selectDailyTowns(FILE.towns, 'usa:2026-11-02')[0]
    expect(day1.id).not.toBe(day2.id)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      `Where is ${promptSchool(day1)}?`,
    )
    // Change the day and force a re-render via an unrelated interaction (the
    // mute toggle) — exactly what a tab left open past midnight experiences.
    window.history.replaceState({}, '', '/?date=2026-11-02')
    fireEvent.click(
      screen.getByRole('button', { name: /Mute sounds|Unmute sounds/ }),
    )
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      `Where is ${promptSchool(day2)}?`,
    )
    window.history.replaceState({}, '', '/')
  })

  it('offers the town search only once the day is finished, as an overlay over the results', async () => {
    const { selectDailyTowns, getDateKey } = await import('./lib/daily')
    const { saveState, STORAGE_VERSION } = await import('./lib/storage')
    const today = getDateKey(new Date())
    const towns = selectDailyTowns(FILE.towns, `usa:${today}`)
    saveState('usa', {
      version: STORAGE_VERSION,
      history: [],
      streak: { current: 1, best: 1, lastPlayedDateKey: today },
      current: {
        dateKey: today,
        towns,
        roundIndex: 4,
        // Modest scores: a strong finish would fire confetti + a cheer, which
        // jsdom has no canvas/audio for.
        results: towns.map((t) => ({
          town: t,
          guess: { lat: t.lat + 3, lng: t.lng },
          distanceMeters: 330_000,
          score: 42,
        })),
        phase: 'finished',
      },
    })
    render(<App />)
    await screen.findByText(/Done for today!/)
    fireEvent.click(
      await screen.findByRole('button', { name: /is my town in the game/ }),
    )
    expect(screen.getByLabelText('Search towns')).toBeTruthy()
    // The results are still in the DOM underneath the overlay.
    expect(screen.getByText(/Done for today!/)).toBeTruthy()
    // Leaflet's zoom control / attribution sit at z-index 1000; the overlay
    // must be above them or the hidden map's "+" takes the tap.
    expect(OVERLAY_Z_INDEX).toBeGreaterThan(1000)
    const overlayEl = screen
      .getByLabelText('Search towns')
      .closest('div[style]')!
    expect(Number((overlayEl as HTMLElement).style.zIndex)).toBe(
      OVERLAY_Z_INDEX,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByLabelText('Search towns')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: /is my town in the game/ }),
    )
    fireEvent.click(screen.getByRole('button', { name: '← back' }))
    expect(screen.queryByLabelText('Search towns')).toBeNull()
  })

  it('starts on satellite, offers a labelled "night lights" button on the map, and remembers the choice', async () => {
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    const credit = () =>
      document.querySelector('.leaflet-control-attribution')?.textContent ?? ''
    await waitFor(() => expect(credit()).toContain('EOX'))
    // No cryptic header icon any more — a worded button on the map itself.
    expect(
      screen.queryByRole('button', { name: /Switch to .* map/ }),
    ).toBeNull()
    const toggle = screen.getByRole('button', { name: /night lights/i })
    expect(toggle.closest('.map-wrap')).toBeTruthy()

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: /satellite/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /night lights/i })).toBeNull()
    await waitFor(() => expect(credit()).toContain('NASA'))
    expect(localStorage.getItem('cps:basemap')).toBe('night')
    // The footer credits both providers (licence: legible, nearby).
    expect(document.querySelector('footer')?.textContent).toContain(
      'EOX IT Services GmbH',
    )

    // A fresh mount honours the saved preference.
    cleanup()
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    expect(screen.getByRole('button', { name: /satellite/i })).toBeTruthy()
    await waitFor(() => expect(credit()).toContain('NASA'))
  })
})
