/**
 * TownSearch — "is my college town in the game?" Look up whether a town (or
 * school) is in the dataset, with an autocomplete list of matches. A miss
 * offers a prefilled GitHub issue to request it.
 */

import { useState, type CSSProperties } from 'react'
import type { Town } from '../types'
import { searchTowns, isIncluded } from '../lib/search'
import { addTownRequestMessage, bugReportUrl } from '../lib/report'

export function TownSearch({
  towns,
  onClose,
}: {
  towns: Town[]
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const matches = searchTowns(towns, query)
  const active = query.trim().length >= 2
  const included = active && isIncluded(towns, query)
  const requestUrl = bugReportUrl({}, addTownRequestMessage(query))

  return (
    <main style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
      <button onClick={onClose} style={linkButton}>
        ← back
      </button>

      <h2 style={{ margin: '8px 0 4px' }}>Is my college town in the game?</h2>
      <p style={{ marginTop: 0, opacity: 0.75 }}>
        Search by town, state, or school. {towns.length} towns so far.
      </p>

      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. Ann Arbor, or Purdue"
        aria-label="Search towns"
        style={{
          width: '100%',
          padding: '8px 10px',
          borderRadius: 8,
          background: '#0b1118',
          color: 'var(--fg)',
          border: '1px solid #2a3543',
          marginBottom: 8,
        }}
      />

      {active && (
        <>
          {included ? (
            <p style={{ color: '#2ecc71', fontWeight: 700 }}>
              ✓ Yes — that’s in the game!
            </p>
          ) : matches.length > 0 ? (
            <p style={{ opacity: 0.8 }}>No exact match. Did you mean:</p>
          ) : (
            <>
              <p style={{ color: '#e67e22', fontWeight: 600, marginBottom: 6 }}>
                Not in the game (yet).
              </p>
              <a
                href={requestUrl}
                target="_blank"
                rel="noreferrer"
                style={requestLink}
              >
                + Request to add it
              </a>
            </>
          )}

          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => setQuery(`${m.name}, ${m.stateCode}`)}
                  style={matchButton}
                >
                  {m.name}, {m.stateCode}{' '}
                  <span style={{ opacity: 0.5, fontSize: 12 }}>
                    · {m.schools.join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}

const linkButton: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#7fb2ff',
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
}

const requestLink: CSSProperties = {
  display: 'inline-block',
  padding: '8px 14px',
  fontSize: 15,
  fontWeight: 600,
  borderRadius: 8,
  background: '#f4b400',
  color: '#0f1720',
  textDecoration: 'none',
  marginBottom: 8,
}

const matchButton: CSSProperties = {
  width: '100%',
  textAlign: 'left',
  padding: '8px 10px',
  background: '#11202e',
  color: 'var(--fg)',
  border: '1px solid #1d2b3a',
  borderRadius: 8,
  marginBottom: 6,
  cursor: 'pointer',
}
