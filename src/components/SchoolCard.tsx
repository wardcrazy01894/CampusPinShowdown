/**
 * SchoolCard — the "about this school" panel shown AFTER a guess: a hand-written
 * fun fact, a few stat lines (type + founded, enrollment, athletics, mascot,
 * U.S. News rank), notable alumni and a Wikipedia credit. Data comes from
 * public/schools.json (lib/schoolFacts.ts), fetched lazily on the first
 * reveal and shared by every card. Renders nothing until the row is known and
 * nothing at all when the school has no row or the file fails to load — the
 * game never depends on it. Used on the reveal (Game) and under each results
 * row (Results). Structure pinned by SchoolCard.render.test.tsx; CSS in
 * index.css (.school-card).
 */

import { useEffect, useState } from 'react'
import type { SchoolsFile } from '../types'
import {
  factChips,
  findSchoolFacts,
  loadSchoolFacts,
  wikipediaUrl,
} from '../lib/schoolFacts'

export interface SchoolCardProps {
  /** The round's prompt school (schools.ts:promptSchool) — the row key. */
  school: string
}

export function SchoolCard({ school }: SchoolCardProps) {
  const [file, setFile] = useState<SchoolsFile | null>(null)
  useEffect(() => {
    let live = true
    loadSchoolFacts().then((f) => {
      if (live) setFile(f)
    })
    return () => {
      live = false
    }
  }, [])

  const facts = findSchoolFacts(file, school)
  if (!file || !facts) return null
  const chips = factChips(facts, file.rankingEdition)

  return (
    <aside className="school-card" aria-label={`About ${school}`}>
      <p className="school-card__fact">
        <span aria-hidden="true">✨ </span>
        {facts.funFact}
      </p>
      {chips.length > 0 && (
        <ul className="school-card__stats">
          {chips.map((c) => (
            <li key={c.icon}>
              <span aria-hidden="true">{c.icon} </span>
              {c.text}
            </li>
          ))}
        </ul>
      )}
      {facts.alumni && facts.alumni.length > 0 && (
        <p className="school-card__alumni">
          <span aria-hidden="true">🌟 </span>
          <strong>Notable alumni:</strong> {facts.alumni.join(' · ')}
        </p>
      )}
      <p className="school-card__credit">
        Stats via{' '}
        <a
          href={wikipediaUrl(facts.wikipedia)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Wikipedia
        </a>{' '}
        (CC BY-SA 4.0)
      </p>
    </aside>
  )
}
