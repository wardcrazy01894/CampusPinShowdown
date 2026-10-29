// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { App } from './App'
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
    // (Leaflet's own attribution control renders a second OSM link.)
    expect(
      screen.getAllByRole('link', { name: 'OpenStreetMap' }).length,
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
