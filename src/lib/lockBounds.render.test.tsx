// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import L from 'leaflet'
import { lockMapToBounds } from './lockBounds'
import { REGION } from './region'

/**
 * Structural net for lockMapToBounds in jsdom (no layout; the container is
 * 0×0, which is fine for everything asserted here).
 *
 * Owner's call (2026-11-05): the map must NEVER move on its own — no
 * maxBounds, no clamp, no recentre on zoom. Only the widest view is locked.
 */

let map: L.Map | null = null
afterEach(() => {
  map?.remove()
  map = null
})

describe('lockMapToBounds', () => {
  it('locks min zoom to the whole-country fit and sets NO maxBounds', () => {
    map = L.map(document.createElement('div'))
    map.fitBounds(REGION.bounds)
    lockMapToBounds(map, REGION.bounds)
    expect(map.getMinZoom()).toBe(map.getBoundsZoom(REGION.bounds))
    expect(map.options.maxBounds).toBeUndefined()
    map.fire('zoomend')
    map.fire('moveend')
    expect(map.options.maxBounds).toBeUndefined()
  })

  it('turns off the zoom-limit bounce so a pinch past min zoom cannot spring back', () => {
    map = L.map(document.createElement('div'))
    expect(map.options.bounceAtZoomLimits).toBe(true) // Leaflet default
    map.fitBounds(REGION.bounds)
    lockMapToBounds(map, REGION.bounds)
    expect(map.options.bounceAtZoomLimits).toBe(false)
  })

  it('re-locks min zoom on resize until unsubscribed', () => {
    map = L.map(document.createElement('div'))
    map.fitBounds(REGION.bounds)
    const unlock = lockMapToBounds(map, REGION.bounds)
    const locked = map.getMinZoom()
    const bogus = locked + 3
    map.setMinZoom(bogus)
    map.fire('resize')
    expect(map.getMinZoom()).toBe(locked)
    unlock()
    map.setMinZoom(bogus)
    map.fire('resize')
    expect(map.getMinZoom()).toBe(bogus)
  })
})
