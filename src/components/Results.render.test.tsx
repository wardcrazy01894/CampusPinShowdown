// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { Results } from './Results'
import { REGION } from '../lib/region'
import type { RoundResult, Town } from '../types'

const town = (name: string, st: string): Town => ({
  id: `${name.toLowerCase()}-${st.toLowerCase()}`,
  name,
  state: st,
  stateCode: st,
  schools: ['U'],
  lat: 40,
  lng: -90,
  difficulty: 'easy',
  source: 'manual',
  attribution: 't',
})
const r = (
  name: string,
  st: string,
  score: number,
  meters: number,
): RoundResult => ({
  town: town(name, st),
  guess: { lat: 0, lng: 0 },
  distanceMeters: meters,
  score,
})
const results = [
  r('Ann Arbor', 'MI', 100, 5_000),
  { ...r('Athens', 'GA', 81, 100_000), hinted: true },
  r('Boulder', 'CO', 46, 300_000),
  r('Oxford', 'OH', 26, 500_000),
  r('Gambier', 'OH', 0, 3_000_000),
]

afterEach(cleanup)

describe('Results', () => {
  it('shows the total, streak, per-town breakdown and the share card', () => {
    render(
      <Results
        dateKey="2026-10-30"
        bounds={REGION.bounds}
        results={results}
        totalScore={253}
        streak={{ current: 2, best: 9 }}
        official={false}
      />,
    )
    expect(screen.getByText('253')).toBeTruthy()
    expect(screen.getByText(/Streak 2 \(best 9\)/)).toBeTruthy()
    expect(screen.getByText('Ann Arbor, MI')).toBeTruthy()
    expect(screen.getByText(/62 mi/)).toBeTruthy()
    const pre = document.querySelector('pre')!
    expect(pre.textContent).toContain('📍 CampusPin Showdown #2')
    expect(pre.textContent).toContain('2026-10-30 · 253/500')
    expect(pre.textContent).toContain('🟩🟩🟧🟧⬛')
    expect(pre.textContent).toContain(window.location.origin)
    expect(screen.getByRole('button', { name: 'Copy result' })).toBeTruthy()
  })

  it('shows the day recap: every round on one map, rows toggle focus', () => {
    const { container } = render(
      <Results
        dateKey="2026-10-30"
        bounds={REGION.bounds}
        results={results}
        totalScore={253}
        streak={{ current: 2, best: 9 }}
        official={false}
      />,
    )
    // One recap map with a numbered marker per round, in play order.
    expect(container.querySelectorAll('.leaflet-map-pane')).toHaveLength(1)
    expect(
      [...container.querySelectorAll('.recap-marker')].map(
        (el) => el.textContent,
      ),
    ).toEqual(['1', '2', '3', '4', '5'])
    // Rows carry the schools line and act as focus toggles.
    const row = screen.getByRole('button', { name: /Athens, GA/ })
    expect(row.textContent).toContain('Home of U')
    expect(row.textContent).toContain('💡 hint') // a hinted round is marked
    expect(row.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(row)
    expect(row.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(row)
    expect(row.getAttribute('aria-pressed')).toBe('false')
    // Focusing never duplicates layers: still exactly five markers.
    expect(container.querySelectorAll('.recap-marker')).toHaveLength(5)
  })

  it('offers "Play today’s puzzle" only on an official day that has rolled over', () => {
    const { unmount } = render(
      <Results
        dateKey="2020-01-01"
        bounds={REGION.bounds}
        results={results}
        totalScore={253}
        streak={{ current: 0, best: 0 }}
        official
      />,
    )
    expect(screen.getByRole('button', { name: /Play today/ })).toBeTruthy()
    expect(screen.getByText(/Done for 2020-01-01!/)).toBeTruthy()
    unmount()
    render(
      <Results
        dateKey="2020-01-01"
        bounds={REGION.bounds}
        results={results}
        totalScore={253}
        streak={{ current: 0, best: 0 }}
        official={false}
      />,
    )
    expect(screen.queryByRole('button', { name: /Play today/ })).toBeNull()
  })
})
