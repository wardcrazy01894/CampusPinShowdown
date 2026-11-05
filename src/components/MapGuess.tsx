/**
 * MapGuess — the interactive USA map for one round.
 *
 * Uses raw Leaflet (via refs) rather than react-leaflet to keep deps light and
 * avoid the default-marker-icon bundler breakage — we draw guess/truth as
 * circle markers and connect them with a polyline on reveal.
 *
 * Tiles: the night or satellite basemap from src/lib/tiles.ts (swapped in
 * place when the `basemap` prop changes), with state outlines from
 * src/lib/states.ts drawn in their own pane.
 *
 * The map is locked to `bounds` by lockMapToBounds (src/lib/lockBounds.ts):
 * a rigid maxBounds edge (MAX_BOUNDS_VISCOSITY) around the play area padded
 * by MAX_BOUNDS_PAD so a coastal town can be centred, grown to the viewport
 * on any axis where it is smaller so a drag clamps instead of springing back.
 * Min zoom locks to the UNPADDED bounds so players can't zoom out past the
 * country; max zoom is capped by the tile layer (MAX_ZOOM) so street-level
 * detail never gives a town away.
 *
 * Anti-cheat note: answers live in the bundled JSON and are readable via
 * devtools. For a friends game that's acceptable and intentional.
 */

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { Guess, Town } from '../types'
import { log } from '../lib/log'
import { MAX_BOUNDS_VISCOSITY } from '../lib/mapBounds'
import { lockMapToBounds } from '../lib/lockBounds'
import { makeTileLayer, MAX_ZOOM } from '../lib/tiles'
import { DEFAULT_BASEMAP, type Basemap } from '../lib/basemap'
import { makeStateOutlines, STATES_PANE } from '../lib/states'

export interface MapGuessProps {
  /** Bounding box the map is locked to, [[south, west], [north, east]]. */
  bounds: [[number, number], [number, number]]
  /** Current guess pin, or null if the player hasn't placed one yet. */
  guess: Guess | null
  onGuessChange: (g: Guess) => void
  /** When set, the round is revealed: show truth marker + distance line. */
  reveal?: { town: Town; distanceMeters: number } | null
  /** Disable interaction after submit. */
  locked?: boolean
  /** Change this (e.g. the round index) to re-frame the map to full bounds. */
  resetViewKey?: number
  /** Imagery to show; defaults to DEFAULT_BASEMAP (satellite). */
  basemap?: Basemap
  /** Pixels of the map hidden under overlays at its top / bottom edge (the
   *  phone layout floats the prompt and the action bar over it). Read when a
   *  reveal is framed so both pins land in the visible part. See
   *  mapBounds.coverInsets. */
  viewInsets?: () => { top: number; bottom: number }
}

export function MapGuess({
  bounds,
  guess,
  onGuessChange,
  reveal,
  locked,
  resetViewKey,
  basemap = DEFAULT_BASEMAP,
  viewInsets,
}: MapGuessProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const guessMarkerRef = useRef<L.CircleMarker | null>(null)
  const truthMarkerRef = useRef<L.CircleMarker | null>(null)
  const lineRef = useRef<L.Polyline | null>(null)
  const tilesRef = useRef<L.TileLayer | null>(null)
  // The basemap the live tile layer was built for (null = no map yet).
  const appliedBasemapRef = useRef<Basemap | null>(null)
  const basemapRef = useRef(basemap)
  basemapRef.current = basemap
  // Keep the latest callback/locked without re-binding the map click handler
  // (the "latest ref" idiom — written during render on purpose; the
  // react-hooks/refs rule is staged to `warn` for exactly this pattern).
  const onGuessRef = useRef(onGuessChange)
  const lockedRef = useRef(locked)
  const viewInsetsRef = useRef(viewInsets)
  onGuessRef.current = onGuessChange
  lockedRef.current = locked
  viewInsetsRef.current = viewInsets

  /** Build + add the tile layer for `b`, remembering which basemap it is. */
  function attachTiles(map: L.Map, b: Basemap) {
    const tiles = makeTileLayer(b)
    tiles.on('tileerror', () => log.debug('MapGuess', 'tile failed to load'))
    tiles.addTo(map)
    tilesRef.current = tiles
    appliedBasemapRef.current = b
  }

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      // maxBounds itself is set (and re-fitted per zoom) by lockMapToBounds.
      maxBoundsViscosity: MAX_BOUNDS_VISCOSITY,
      zoomControl: true,
    })
    attachTiles(map, basemapRef.current)
    // State outlines over the night imagery, in their own pane BELOW the
    // default overlay pane (z 400) so markers and the reveal line stay on top.
    map.createPane(STATES_PANE).style.zIndex = '350'
    // Async: the GeoJSON is its own chunk. Only attach if THIS map is still
    // the live one (StrictMode double-mount / unmount race).
    void makeStateOutlines()
      .then((layer) => {
        if (mapRef.current === map) layer.addTo(map)
      })
      // A failed chunk load just means no borders — the map still works.
      .catch((e: unknown) =>
        log.warn('MapGuess', 'state outlines failed to load', {
          error: String(e),
        }),
      )
    map.fitBounds(bounds)
    // Min zoom = this widest view; maxBounds = padded play area, grown to the
    // viewport where it is smaller so a drag never springs back (lockBounds).
    const unlock = lockMapToBounds(map, bounds)
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (lockedRef.current) return
      log.debug('MapGuess', 'guess placed', {
        lat: e.latlng.lat,
        lng: e.latlng.lng,
      })
      onGuessRef.current({ lat: e.latlng.lat, lng: e.latlng.lng })
    })
    mapRef.current = map
    log.debug('MapGuess', 'map initialized')
    return () => {
      unlock()
      map.remove()
      mapRef.current = null
      tilesRef.current = null
      appliedBasemapRef.current = null
    }
    // bounds is constant for the game; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap imagery in place when the basemap preference changes: remove the old
  // tile layer, add the new one. View, pins and outlines are untouched.
  useEffect(() => {
    const map = mapRef.current
    // No map yet, or the create effect already built this basemap (the swap
    // effect also fires on mount, right after it) — nothing to do.
    if (!map || appliedBasemapRef.current === basemap) return
    tilesRef.current?.remove()
    attachTiles(map, basemap)
  }, [basemap])

  // Sync the guess marker.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!guess) {
      guessMarkerRef.current?.remove()
      guessMarkerRef.current = null
      return
    }
    const latlng: L.LatLngExpression = [guess.lat, guess.lng]
    if (guessMarkerRef.current) {
      guessMarkerRef.current.setLatLng(latlng)
    } else {
      guessMarkerRef.current = L.circleMarker(latlng, {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#f4b400',
        fillOpacity: 1,
      }).addTo(map)
    }
  }, [guess])

  // Sync the reveal (truth marker + connecting line + fit both in view).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    truthMarkerRef.current?.remove()
    truthMarkerRef.current = null
    lineRef.current?.remove()
    lineRef.current = null
    if (!reveal) return

    const truth: L.LatLngExpression = [reveal.town.lat, reveal.town.lng]
    // Use a text node, NOT a raw string — Leaflet's bindTooltip(string) assigns
    // innerHTML, which would execute HTML in a town name (stored XSS). A span +
    // textContent is safe regardless of the name's content.
    const label = document.createElement('span')
    label.textContent = `${reveal.town.name}, ${reveal.town.stateCode}`
    truthMarkerRef.current = L.circleMarker(truth, {
      radius: 9,
      color: '#ffffff',
      weight: 2,
      fillColor: '#2ecc71',
      fillOpacity: 1,
    })
      .addTo(map)
      .bindTooltip(label, { permanent: true, direction: 'top' })
      .openTooltip()

    if (guess) {
      lineRef.current = L.polyline([[guess.lat, guess.lng], truth], {
        color: '#f4b400',
        weight: 2,
        dashArray: '6 6',
      }).addTo(map)
    }

    // Frame the guess pin + truth marker (+ line) so nothing is clipped —
    // inside the part of the map not hidden under the floating cards.
    const insets = viewInsetsRef.current?.() ?? { top: 0, bottom: 0 }
    const candidates: (L.Layer | null)[] = [
      guess ? L.marker([guess.lat, guess.lng]) : null,
      truthMarkerRef.current,
      lineRef.current,
    ]
    const framed = L.featureGroup(
      candidates.filter((l): l is L.Layer => l != null),
    )
    map.fitBounds(framed.getBounds().pad(0.3), {
      maxZoom: MAX_ZOOM,
      paddingTopLeft: [0, insets.top],
      paddingBottomRight: [0, insets.bottom],
    })
  }, [reveal, guess])

  // Re-frame to the full play area at the start of each new round.
  useEffect(() => {
    const map = mapRef.current
    if (!map || reveal) return
    map.fitBounds(bounds)
    // Only react to the round changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetViewKey])

  return <div className="map-container" ref={containerRef} />
}
