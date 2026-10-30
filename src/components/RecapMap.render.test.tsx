// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import L from 'leaflet'
import { StrictMode } from 'react'
import { render, cleanup } from '@testing-library/react'
import { RecapMap } from './RecapMap'
import { REGION } from '../lib/region'
import type { RoundResult } from '../types'

/**
 * Structural Leaflet net for RecapMap (same spirit as MapGuess.render.test.tsx):
 * one map under StrictMode, every round's guess pin + truth marker + distance
 * line drawn, numbered labels in play order, and nothing left behind on
 * unmount. Checkable in jsdom without real tiles.
 */

function result(i: number): RoundResult {
  const lat = 40 + i
  const lng = -90 + i
  return {
    town: {
      id: `town-${i}`,
      name: `Town ${i}`,
      state: 'Ohio',
      stateCode: 'OH',
      schools: ['U'],
      lat,
      lng,
      difficulty: 'easy',
      source: 'manual',
      attribution: 't',
    },
    guess: { lat: lat + 0.5, lng: lng - 0.5 },
    distanceMeters: 70_000,
    score: 60,
  }
}

afterEach(cleanup)

describe('RecapMap Leaflet lifecycle', () => {
  it('creates exactly one map under StrictMode and draws every round', () => {
    const results = [result(0), result(1), result(2)]
    const { container } = render(
      <StrictMode>
        <RecapMap bounds={REGION.bounds} results={results} />
      </StrictMode>,
    )
    expect(container.querySelectorAll('.leaflet-map-pane')).toHaveLength(1)
    // Per round: 1 guess circle + 1 dashed line — SVG paths in the overlay
    // pane. Truth markers are numbered divIcons.
    expect(
      container.querySelectorAll('.leaflet-overlay-pane path'),
    ).toHaveLength(3 * 2)
    const labels = [...container.querySelectorAll('.recap-marker')].map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(['1', '2', '3'])
  })

  it('removes the Leaflet map on unmount (no leak into the next mount)', () => {
    // After unmount React has already dropped the <div>, so counting DOM
    // nodes proves nothing — assert that Leaflet's own teardown ran instead.
    const remove = vi.spyOn(L.Map.prototype, 'remove')
    const { container, unmount } = render(
      <StrictMode>
        <RecapMap bounds={REGION.bounds} results={[result(0), result(1)]} />
      </StrictMode>,
    )
    const mapDiv = container.querySelector('.recap-map') as HTMLElement
    unmount()
    // StrictMode mounts twice → two maps created → two removed.
    expect(remove).toHaveBeenCalledTimes(2)
    // The container Leaflet used is left bare: no panes, no leaflet id.
    expect(mapDiv.querySelector('.leaflet-pane')).toBeNull()
    expect((mapDiv as unknown as { _leaflet_id?: number })._leaflet_id).toBe(
      undefined,
    )
    remove.mockRestore()
  })

  it('re-frames to the focused round (not the whole day) without duplicating layers', () => {
    const fit = vi.spyOn(L.Map.prototype, 'fitBounds')
    const results = [result(0), result(1)]
    const { container, rerender } = render(
      <StrictMode>
        <RecapMap bounds={REGION.bounds} results={results} focus={null} />
      </StrictMode>,
    )
    const lastFit = () =>
      fit.mock.calls[fit.mock.calls.length - 1][0] as L.LatLngBounds
    // Whole day: the frame covers both rounds' truth markers.
    expect(lastFit().contains([results[0].town.lat, results[0].town.lng])).toBe(
      true,
    )
    expect(lastFit().contains([results[1].town.lat, results[1].town.lng])).toBe(
      true,
    )
    rerender(
      <StrictMode>
        <RecapMap bounds={REGION.bounds} results={results} focus={1} />
      </StrictMode>,
    )
    // Focused: round 1's truth + guess are in, round 0's truth is out.
    const r1 = results[1]
    expect(lastFit().contains([r1.town.lat, r1.town.lng])).toBe(true)
    expect(lastFit().contains([r1.guess.lat, r1.guess.lng])).toBe(true)
    expect(lastFit().contains([results[0].town.lat, results[0].town.lng])).toBe(
      false,
    )
    expect(container.querySelectorAll('.recap-marker')).toHaveLength(2)
    expect(
      container.querySelectorAll('.leaflet-overlay-pane path'),
    ).toHaveLength(4)
    fit.mockRestore()
  })

  it('swaps the tile layer when the basemap prop changes, keeping one layer', () => {
    const results = [result(0)]
    const { container, rerender } = render(
      <StrictMode>
        <RecapMap bounds={REGION.bounds} results={results} basemap="night" />
      </StrictMode>,
    )
    const credit = () =>
      container.querySelector('.leaflet-control-attribution')?.textContent ?? ''
    const tileLayers = () =>
      container.querySelectorAll('.leaflet-tile-pane > .leaflet-layer').length
    expect(credit()).toContain('NASA')
    expect(tileLayers()).toBe(1)
    rerender(
      <StrictMode>
        <RecapMap
          bounds={REGION.bounds}
          results={results}
          basemap="satellite"
        />
      </StrictMode>,
    )
    expect(credit()).toContain('EOX')
    expect(credit()).not.toContain('NASA')
    expect(tileLayers()).toBe(1)
    expect(container.querySelectorAll('.leaflet-map-pane')).toHaveLength(1)
  })
})
