// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import L from 'leaflet'
import { lockMapToBounds } from './lockBounds'
import { padBounds } from './mapBounds'
import { REGION } from './region'

/**
 * Structural net for lockMapToBounds in jsdom (no layout: the container is
 * 0×0, which exercises the "no size → plain padded lock" guard).
 */

let map: L.Map | null = null
/** The live lock box; setMaxBounds always stores a LatLngBounds instance. */
const lock = (m: L.Map) => m.options.maxBounds as L.LatLngBounds
afterEach(() => {
  map?.remove()
  map = null
})

describe('lockMapToBounds', () => {
  it('locks maxBounds to the padded play area when the container has no size', () => {
    map = L.map(document.createElement('div'))
    map.fitBounds(REGION.bounds)
    lockMapToBounds(map, REGION.bounds)
    const expected = L.latLngBounds(padBounds(REGION.bounds))
    expect(lock(map).equals(expected)).toBe(true)
    expect(map.getMinZoom()).toBe(map.getBoundsZoom(REGION.bounds))
  })

  it('stops listening once unsubscribed', () => {
    map = L.map(document.createElement('div'))
    map.fitBounds(REGION.bounds)
    const unlock = lockMapToBounds(map, REGION.bounds)
    map.setMaxBounds([
      [0, 0],
      [1, 1],
    ])
    // Still subscribed: a resize re-applies the lock over the bogus box.
    map.fire('resize')
    expect(lock(map).getNorth()).toBeGreaterThan(1)
    unlock()
    map.setMaxBounds([
      [0, 0],
      [1, 1],
    ])
    map.fire('resize')
    expect(lock(map).getNorth()).toBe(1)
  })
})
