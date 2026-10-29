import { describe, it, expect } from 'vitest'
import usStates from '../data/us-states.json'
import { REGION, inRegion } from './region'

type Pt = [number, number]
const ring = (c: unknown): Pt[] => c as Pt[]

describe('src/data/us-states.json (state outlines)', () => {
  it('has the lower 48 + DC and nothing else', () => {
    expect(usStates.features).toHaveLength(49)
    const names = (usStates.features as { properties: { name: string } }[]).map(
      (f) => f.properties.name,
    )
    expect(names).not.toContain('Alaska')
    expect(names).not.toContain('Hawaii')
    expect(names).not.toContain('Puerto Rico')
    expect(names).toContain('Michigan')
    expect(names).toContain('District of Columbia')
  })

  it('every vertex lies inside the play region (so the outlines never hint at a wider map)', () => {
    for (const f of usStates.features as {
      properties: { name: string }
      geometry: { type: string; coordinates: unknown }
    }[]) {
      const rings =
        f.geometry.type === 'Polygon'
          ? (f.geometry.coordinates as unknown[]).map(ring)
          : (f.geometry.coordinates as unknown[][]).flatMap((poly) =>
              poly.map(ring),
            )
      for (const r of rings)
        for (const [lng, lat] of r)
          expect(inRegion(REGION, { lat, lng }), f.properties.name).toBe(true)
    }
  })

  it('is small enough to bundle (simplified, 3-decimal coordinates)', () => {
    expect(JSON.stringify(usStates).length).toBeLessThan(150_000)
  })
})
