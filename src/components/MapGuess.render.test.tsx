// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, cleanup, waitFor } from '@testing-library/react'
import { MapGuess } from './MapGuess'
import { REGION } from '../lib/region'
import type { Town } from '../types'

/**
 * Leaflet lifecycle net for MapGuess (structural, not visual): under
 * StrictMode's double-invoke exactly one map must exist, and no round's layers
 * may survive into the next. That is what a ref/effect regression would break,
 * and it is checkable in jsdom without real tiles.
 */

const town = (id: string, lat: number, lng: number): Town => ({
  id,
  name: 'Ann Arbor',
  state: 'Michigan',
  stateCode: 'MI',
  schools: ['University of Michigan'],
  lat,
  lng,
  difficulty: 'easy',
  source: 'manual',
  attribution: 'test fixture',
})

afterEach(cleanup)

describe('MapGuess Leaflet lifecycle', () => {
  it('draws the state outlines in their own pane, under the marker pane', async () => {
    const { container } = render(
      <MapGuess bounds={REGION.bounds} guess={null} onGuessChange={() => {}} />,
    )
    const pane = container.querySelector('.leaflet-states-pane') as HTMLElement
    expect(pane).toBeTruthy()
    // Lazy-loaded chunk → wait for it.
    await waitFor(() =>
      expect(pane.querySelectorAll('path').length).toBeGreaterThan(40),
    )
    expect(Number(pane.style.zIndex)).toBeLessThan(400)
    // …and they are NOT in the overlay pane the reveal/leak assertions count.
    expect(
      container.querySelectorAll('.leaflet-overlay-pane path'),
    ).toHaveLength(0)
  })

  it('creates exactly one map under StrictMode double-invoke', () => {
    const { container } = render(
      <StrictMode>
        <MapGuess
          bounds={REGION.bounds}
          guess={null}
          onGuessChange={() => {}}
        />
      </StrictMode>,
    )
    expect(container.querySelectorAll('.leaflet-map-pane')).toHaveLength(1)
  })

  it('reveals "Name, ST" (not the full state) and does not leak layers across rounds', () => {
    const { container, rerender } = render(
      <StrictMode>
        <MapGuess
          bounds={REGION.bounds}
          guess={{ lat: 40, lng: -90 }}
          onGuessChange={() => {}}
          reveal={{
            town: town('round-1', 42.28, -83.74),
            distanceMeters: 120_000,
          }}
          locked
          resetViewKey={0}
        />
      </StrictMode>,
    )
    // Truth marker + distance line render as SVG paths.
    expect(
      container.querySelectorAll('.leaflet-overlay-pane path').length,
    ).toBeGreaterThan(1)
    const tip = container.querySelector('.leaflet-tooltip')
    expect(tip?.textContent).toBe('Ann Arbor, MI')
    expect(tip?.textContent).not.toContain('Michigan')

    rerender(
      <StrictMode>
        <MapGuess
          bounds={REGION.bounds}
          guess={null}
          onGuessChange={() => {}}
          reveal={null}
          resetViewKey={1}
        />
      </StrictMode>,
    )
    expect(
      container.querySelectorAll('.leaflet-overlay-pane path'),
    ).toHaveLength(0)
    expect(container.querySelectorAll('.leaflet-tooltip')).toHaveLength(0)
    expect(container.querySelectorAll('.leaflet-map-pane')).toHaveLength(1)
  })

  it('escapes HTML in a town name (tooltip uses textContent)', () => {
    const evil = { ...town('x', 42, -83), name: '<img src=x onerror=alert(1)>' }
    const { container } = render(
      <MapGuess
        bounds={REGION.bounds}
        guess={null}
        onGuessChange={() => {}}
        reveal={{ town: evil, distanceMeters: 0 }}
        locked
      />,
    )
    expect(container.querySelector('.leaflet-tooltip img')).toBeNull()
    expect(container.querySelector('.leaflet-tooltip')?.textContent).toContain(
      '<img',
    )
  })

  it('swaps the tile layer when the basemap prop changes, keeping one map', () => {
    const { container, rerender } = render(
      <MapGuess
        bounds={REGION.bounds}
        guess={null}
        onGuessChange={() => {}}
        basemap="night"
      />,
    )
    const credit = () =>
      container.querySelector('.leaflet-control-attribution')?.textContent ?? ''
    expect(credit()).toContain('NASA')
    expect(credit()).not.toContain('EOX')

    rerender(
      <MapGuess
        bounds={REGION.bounds}
        guess={null}
        onGuessChange={() => {}}
        basemap="satellite"
      />,
    )
    expect(credit()).toContain('EOX')
    expect(credit()).not.toContain('NASA')
    expect(container.querySelectorAll('.leaflet-map-pane')).toHaveLength(1)
    // Exactly ONE tile layer after the swap (and none duplicated on mount).
    expect(
      container.querySelectorAll('.leaflet-tile-pane > .leaflet-layer'),
    ).toHaveLength(1)
  })
})
