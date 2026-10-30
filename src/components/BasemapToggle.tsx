/**
 * BasemapToggle — the worded "switch imagery" button that sits on top of a
 * map (top-right, see `.basemap-toggle` in index.css). It names the map you
 * would GET, not the one you are on, so it reads as an invitation:
 * "🌃 Switch to night lights" while on satellite, "🛰️ Switch to satellite"
 * while on night. Rendered by Game (play map) and Results (recap map); the
 * preference itself lives in App (src/lib/basemap.ts).
 */

import type { Basemap } from '../lib/basemap'
import { nextBasemap } from '../lib/basemap'

export interface BasemapToggleProps {
  basemap: Basemap
  onChange: (next: Basemap) => void
}

/** Icon + words; the emoji is decoration, hidden from screen readers. */
const LABEL: Record<Basemap, { icon: string; text: string }> = {
  night: { icon: '🌃', text: 'Switch to night lights' },
  satellite: { icon: '🛰️', text: 'Switch to satellite' },
}

export function BasemapToggle({ basemap, onChange }: BasemapToggleProps) {
  const next = nextBasemap(basemap)
  return (
    <button
      type="button"
      className="basemap-toggle"
      onClick={() => onChange(next)}
    >
      <span aria-hidden="true">{LABEL[next].icon}</span> {LABEL[next].text}
    </button>
  )
}
