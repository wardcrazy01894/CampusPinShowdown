// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
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

  it('removes every layer on unmount (no leak into the next mount)', () => {
    const { container, unmount } = render(
      <StrictMode>
        <RecapMap bounds={REGION.bounds} results={[result(0), result(1)]} />
      </StrictMode>,
    )
    unmount()
    expect(container.querySelectorAll('.leaflet-map-pane')).toHaveLength(0)
    expect(container.querySelectorAll('.recap-marker')).toHaveLength(0)
  })

  it('re-frames on focus without duplicating layers', () => {
    const results = [result(0), result(1)]
    const { container, rerender } = render(
      <StrictMode>
        <RecapMap bounds={REGION.bounds} results={results} focus={null} />
      </StrictMode>,
    )
    rerender(
      <StrictMode>
        <RecapMap bounds={REGION.bounds} results={results} focus={1} />
      </StrictMode>,
    )
    expect(container.querySelectorAll('.recap-marker')).toHaveLength(2)
    expect(
      container.querySelectorAll('.leaflet-overlay-pane path'),
    ).toHaveLength(4)
  })
})
