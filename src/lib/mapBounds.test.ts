import { describe, expect, it } from 'vitest'
import { padBounds, MAX_BOUNDS_PAD } from './mapBounds'

describe('padBounds', () => {
  it('expands each side by the given ratio of that axis extent', () => {
    // 1° tall × 2° wide box, padded 30% per side.
    const padded = padBounds(
      [
        [27, -84],
        [28, -82],
      ],
      0.3,
    )
    expect(padded).toEqual([
      [26.7, -84.6],
      [28.3, -81.4],
    ])
  })

  it('returns the same box for ratio 0', () => {
    const bounds: [[number, number], [number, number]] = [
      [47.48, -122.46],
      [47.75, -122.22],
    ]
    expect(padBounds(bounds, 0)).toEqual(bounds)
  })

  it('defaults to MAX_BOUNDS_PAD and does not mutate the input', () => {
    const bounds: [[number, number], [number, number]] = [
      [27, -84],
      [28, -82],
    ]
    const padded = padBounds(bounds)
    expect(padded).toEqual(padBounds(bounds, MAX_BOUNDS_PAD))
    expect(bounds).toEqual([
      [27, -84],
      [28, -82],
    ])
    // The default pad must actually widen the box (the whole point of padding).
    expect(MAX_BOUNDS_PAD).toBeGreaterThan(0)
    // …but stay continent-appropriate: on the lower-48 box (~25° × ~59°) more
    // than ~0.1 per side would let players pan deep into Mexico/Canada/ocean.
    expect(MAX_BOUNDS_PAD).toBeLessThanOrEqual(0.1)
    expect(padded[0][0]).toBeLessThan(27)
    expect(padded[1][0]).toBeGreaterThan(28)
  })
})

describe('MAX_BOUNDS_VISCOSITY', () => {
  it('is elastic: the edge resists a drag but is not a hard wall', async () => {
    const { MAX_BOUNDS_VISCOSITY } = await import('./mapBounds')
    // 1 = rigid wall (the pan just stops — "hard to move around" on a phone);
    // 0 = no resistance at all (the map drifts off into the ocean and snaps
    // back). Anything strictly between gives a rubber-band edge.
    expect(MAX_BOUNDS_VISCOSITY).toBeGreaterThan(0)
    expect(MAX_BOUNDS_VISCOSITY).toBeLessThan(1)
  })
})

describe('coverInsets', () => {
  const map = { top: 100, bottom: 700, left: 0, right: 390 }
  it('is zero when nothing overlaps the map (desktop: cards stack above/below)', async () => {
    const { coverInsets } = await import('./mapBounds')
    expect(
      coverInsets(map, [
        { top: 0, bottom: 90, left: 0, right: 390 },
        { top: 720, bottom: 780, left: 0, right: 390 },
      ]),
    ).toEqual({ top: 0, bottom: 0 })
  })

  it('measures how far a card over the top or bottom edge reaches into the map', async () => {
    const { coverInsets } = await import('./mapBounds')
    expect(
      coverInsets(map, [
        { top: 108, bottom: 210, left: 8, right: 382 }, // prompt card
        { top: 630, bottom: 688, left: 8, right: 382 }, // action bar
      ]),
    ).toEqual({ top: 110, bottom: 70 })
  })

  it('ignores covers beside the map and takes the deepest of several', async () => {
    const { coverInsets } = await import('./mapBounds')
    expect(
      coverInsets(map, [
        { top: 108, bottom: 300, left: 400, right: 500 }, // off to the side
        { top: 100, bottom: 150, left: 0, right: 390 },
        { top: 100, bottom: 180, left: 0, right: 390 },
      ]),
    ).toEqual({ top: 80, bottom: 0 })
  })
})
