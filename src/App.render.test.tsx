// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
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
    expect(h2.textContent).toMatch(/^Where is [A-Za-z ]+\?$/)
    // The clue is the school, never the state name.
    expect(screen.getByText(/^Home of University of/)).toBeTruthy()
    for (const t of FILE.towns) {
      expect(h2.textContent).not.toContain(t.state)
    }
  })

  it('credits the idea in the footer and shows the map attribution', async () => {
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    expect(
      screen.getByText('Idea courtesy of good friend Garret B.'),
    ).toBeTruthy()
    expect(screen.getByText(/Town coordinates © test/)).toBeTruthy()
    // (Leaflet's own attribution control renders a second Esri link.)
    expect(
      screen.getAllByRole('link', { name: 'Esri' }).length,
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
      `Where is ${day1.name}?`,
    )
    // Change the day and force a re-render via an unrelated interaction (the
    // mute toggle) — exactly what a tab left open past midnight experiences.
    window.history.replaceState({}, '', '/?date=2026-11-02')
    fireEvent.click(
      screen.getByRole('button', { name: /Mute sounds|Unmute sounds/ }),
    )
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      `Where is ${day2.name}?`,
    )
    window.history.replaceState({}, '', '/')
  })

  it('keeps the game mounted (and its pin) while the town search overlay is open', async () => {
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    fireEvent.click(
      screen.getByRole('button', { name: /is my town in the game/ }),
    )
    expect(screen.getByLabelText('Search towns')).toBeTruthy()
    // The round is still in the DOM underneath the overlay.
    expect(screen.getByText(/Round 1 of 5/)).toBeTruthy()
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
})
