import { describe, expect, it } from 'vitest'

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
