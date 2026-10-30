// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { makeTileLayer, MAX_ZOOM, BASEMAPS } from './tiles'

/** Leaflet keeps the URL template on a private field; fine for a test. */
const urlOf = (layer: L.TileLayer) =>
  (layer as unknown as { _url: string })._url

describe('makeTileLayer', () => {
  it('night is the NASA Black Marble layer, upscaled past zoom 8', () => {
    const layer = makeTileLayer('night')
    expect(urlOf(layer)).toContain('gibs.earthdata.nasa.gov')
    expect(layer.getAttribution?.()).toContain('NASA GIBS')
    expect(layer.options.maxZoom).toBe(MAX_ZOOM)
    expect(layer.options.maxNativeZoom).toBe(8)
  })

  it('defaults to the satellite map', () => {
    expect(urlOf(makeTileLayer())).toContain('tiles.maps.eox.at')
  })

  it('satellite is the EOX Sentinel-2 cloudless mosaic with its required credit', () => {
    const layer = makeTileLayer('satellite')
    expect(urlOf(layer)).toMatch(
      /^https:\/\/tiles\.maps\.eox\.at\/wmts\/1\.0\.0\/s2cloudless-\d{4}_3857\/default\/g\/\{z\}\/\{y\}\/\{x\}\.jpg$/,
    )
    const credit = layer.getAttribution?.() ?? ''
    // The licence asks for the product, EOX, and the Copernicus line, legibly
    // next to the map; the year must match the layer being served.
    const year = urlOf(layer).match(/s2cloudless-(\d{4})/)![1]
    expect(credit).toContain('EOX IT Services GmbH')
    expect(credit).toContain(
      `Contains modified Copernicus Sentinel data ${year}`,
    )
    expect(credit).toContain('CC BY-NC-SA 4.0')
    expect(layer.options.maxZoom).toBe(MAX_ZOOM)
    // Full-resolution all the way to the cap: no upscaling needed.
    expect(layer.options.maxNativeZoom).toBe(MAX_ZOOM)
  })

  it('every basemap has a label for the toggle', () => {
    expect(Object.keys(BASEMAPS).sort()).toEqual(['night', 'satellite'])
    for (const b of Object.values(BASEMAPS))
      expect(b.label.length).toBeGreaterThan(0)
  })
})
