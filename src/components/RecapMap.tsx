/**
 * RecapMap — a read-only night map showing ALL of the day's rounds at once:
 * each real town as a numbered green marker (play order), the player's guess
 * as an amber pin, and a dashed line between them. Shown on the results
 * screen, never during play (it would answer the rounds).
 *
 * Same raw-Leaflet-via-refs approach as MapGuess. Every layer lives in ONE
 * feature group that is rebuilt whenever `results` change and removed on
 * unmount, so nothing can leak across mounts. `focus` frames a single round
 * (tapping its row); null frames all of them.
 */

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { RoundResult } from '../types'
import { log } from '../lib/log'
import { padBounds } from '../lib/mapBounds'
import { makeTileLayer, MAX_ZOOM } from '../lib/tiles'
import { makeStateOutlines, STATES_PANE } from '../lib/states'

export interface RecapMapProps {
  /** Play bounds [[south, west], [north, east]] — the widest allowed view. */
  bounds: [[number, number], [number, number]]
  /** The day's rounds in play order. */
  results: RoundResult[]
  /** Index of the round to frame, or null/undefined to frame the whole day. */
  focus?: number | null
}

/** Numbered marker for the real town — a div icon so the label is crisp text. */
function numberedIcon(n: number): L.DivIcon {
  // `html` is injected as innerHTML — `n` is a number we generate, never data.
  return L.divIcon({
    className: 'recap-marker-wrap',
    html: `<span class="recap-marker">${n}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

/** Bounds covering one round's guess and truth marker. */
function roundBounds(r: RoundResult): L.LatLngBounds {
  return L.latLngBounds([r.town.lat, r.town.lng], [r.guess.lat, r.guess.lng])
}

export function RecapMap({ bounds, results, focus }: RecapMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<L.FeatureGroup | null>(null)

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      maxBounds: padBounds(bounds),
      maxBoundsViscosity: 1,
      zoomControl: true,
    })
    const tiles = makeTileLayer()
    tiles.on('tileerror', () => log.debug('RecapMap', 'tile failed to load'))
    tiles.addTo(map)
    map.createPane(STATES_PANE).style.zIndex = '350'
    void makeStateOutlines()
      .then((layer) => {
        if (mapRef.current === map) layer.addTo(map)
      })
      // A failed chunk load just means no borders — the map still works.
      .catch((e: unknown) =>
        log.warn('RecapMap', 'state outlines failed to load', {
          error: String(e),
        }),
      )
    map.fitBounds(bounds)
    const lockMinZoom = () => map.setMinZoom(map.getBoundsZoom(bounds))
    lockMinZoom()
    map.on('resize', lockMinZoom)
    mapRef.current = map
    log.debug('RecapMap', 'map initialized')
    return () => {
      map.remove()
      mapRef.current = null
      layersRef.current = null
    }
    // bounds is constant for a mounted recap; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // (Re)draw every round's layers as one group.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layersRef.current?.remove()
    const group = L.featureGroup()
    results.forEach((r, i) => {
      const truth: L.LatLngExpression = [r.town.lat, r.town.lng]
      const guess: L.LatLngExpression = [r.guess.lat, r.guess.lng]
      L.polyline([guess, truth], {
        color: '#f4b400',
        weight: 2,
        dashArray: '6 6',
      }).addTo(group)
      L.circleMarker(guess, {
        radius: 6,
        color: '#ffffff',
        weight: 2,
        fillColor: '#f4b400',
        fillOpacity: 1,
      }).addTo(group)
      // Text node, not a string: Leaflet's bindTooltip(string) sets innerHTML,
      // and a town name is data (see MapGuess for the same guard).
      const label = document.createElement('span')
      label.textContent = `${r.town.name}, ${r.town.stateCode}`
      L.marker(truth, { icon: numberedIcon(i + 1), keyboard: false })
        .bindTooltip(label, { direction: 'top', offset: [0, -12] })
        .addTo(group)
    })
    group.addTo(map)
    layersRef.current = group
    return () => {
      group.remove()
      if (layersRef.current === group) layersRef.current = null
    }
  }, [results])

  // Frame one round or the whole day.
  useEffect(() => {
    const map = mapRef.current
    if (!map || results.length === 0) return
    const target =
      focus != null && results[focus]
        ? roundBounds(results[focus])
        : results.map(roundBounds).reduce((acc, b) => acc.extend(b))
    map.fitBounds(target.pad(0.25), { maxZoom: MAX_ZOOM })
  }, [results, focus])

  return <div className="map-container recap-map" ref={containerRef} />
}
