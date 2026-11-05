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
    // The pad must leave room to CENTRE a coastal town while zoomed in: with
    // a rigid edge (see MAX_BOUNDS_VISCOSITY) the pad is the only slack there
    // is, and below ~0.15 (≈3.7° lat / ≈9° lng on the lower-48 box) a phone
    // at zoom 7 cannot bring Miami or Seattle to the middle of the screen.
    expect(MAX_BOUNDS_PAD).toBeGreaterThanOrEqual(0.15)
    // …but stay continent-appropriate: much more than ~0.25 per side would let
    // players pan deep into Mexico/Canada/open ocean.
    expect(MAX_BOUNDS_PAD).toBeLessThanOrEqual(0.25)
    expect(padded[0][0]).toBeLessThan(27)
    expect(padded[1][0]).toBeGreaterThan(28)
  })
})

describe('MAX_BOUNDS_VISCOSITY', () => {
  it('is rigid: any give lets the drag overshoot and spring back', async () => {
    const { MAX_BOUNDS_VISCOSITY } = await import('./mapBounds')
    // Shipped 0.6 once (#24): Leaflet lets the drag overshoot the edge by
    // (1 − v) of the excess, then animates a pan back inside on release —
    // reported as "jittery". 1 stops the drag at the edge instead; the slack
    // for moving around comes from MAX_BOUNDS_PAD.
    expect(MAX_BOUNDS_VISCOSITY).toBe(1)
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

describe('expandToViewport', () => {
  // Leaflet's maxBounds only CLAMPS when the lock box is at least as big as
  // the viewport. When the box is shorter (portrait phone at the widest
  // zoom), Leaflet lets the whole box slide up and down inside the viewport
  // during a drag and then animates it back to centre on release — the
  // "jittery scroll" players feel. Growing the box to the viewport on that
  // axis leaves nothing to slide and nothing to snap back.
  it('grows a box shorter than the viewport to the viewport height, centred', async () => {
    const { expandToViewport } = await import('./mapBounds')
    expect(
      expandToViewport(
        { min: { x: 0, y: 100 }, max: { x: 390, y: 360 } },
        { x: 390, y: 700 },
      ),
    ).toEqual({ min: { x: 0, y: -120 }, max: { x: 390, y: 580 } })
  })

  it('grows a box narrower than the viewport on x only', async () => {
    const { expandToViewport } = await import('./mapBounds')
    expect(
      expandToViewport(
        { min: { x: 100, y: -500 }, max: { x: 300, y: 1500 } },
        { x: 720, y: 430 },
      ),
    ).toEqual({ min: { x: -160, y: -500 }, max: { x: 560, y: 1500 } })
  })

  it('leaves a box at least as big as the viewport alone (and does not mutate it)', async () => {
    const { expandToViewport } = await import('./mapBounds')
    const box = { min: { x: -50, y: -20 }, max: { x: 800, y: 900 } }
    expect(expandToViewport(box, { x: 390, y: 700 })).toEqual(box)
    expect(expandToViewport(box, { x: 390, y: 700 })).not.toBe(box)
  })
})
