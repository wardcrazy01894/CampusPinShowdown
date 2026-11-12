/**
 * SchoolSearch — "is my school in the game?" Type a school, see whether it is
 * in the dataset. A miss offers to request it — via the in-app report form
 * when `onRequest` is given, else a prefilled GitHub issue.
 *
 * It shows SCHOOL NAMES only — never a town or a state, which are the answer
 * to a round (lib/search.ts) — so App offers it on every screen, not just
 * after the day is finished.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import type { Town } from '../types'
import { searchSchools, schoolCount } from '../lib/search'
import { addTownRequestMessage, bugReportUrl } from '../lib/report'

/** Matches listed before "…and N more". */
const SHOWN = 12

export function SchoolSearch({
  towns,
  onClose,
  onRequest,
}: {
  towns: Town[]
  onClose: () => void
  /** Open the in-app report form prefilled with an "add this school" request.
   *  Without it the request is a prefilled GitHub issue link. */
  onRequest?: (message: string) => void
}) {
  const [query, setQuery] = useState('')
  // Escape closes the overlay (it has no backdrop to click).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const matches = searchSchools(towns, query)
  const active = query.trim().length >= 2
  const requestMessage = addTownRequestMessage(query)
  const requestUrl = bugReportUrl({}, requestMessage)
  const total = schoolCount(towns)

  return (
    <main style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
      <button onClick={onClose} style={linkButton}>
        ← back
      </button>

      <h2 style={{ margin: '8px 0 4px' }}>Is my school in the game?</h2>
      <p style={{ marginTop: 0, opacity: 0.75 }}>
        Type a school’s name. {total.toLocaleString('en-US')}{' '}
        {total === 1 ? 'school' : 'schools'} so far. No spoilers: it never says
        where a school is.
      </p>

      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. Purdue"
        aria-label="Search schools"
        style={{
          width: '100%',
          padding: '8px 10px',
          borderRadius: 8,
          background: '#0b1118',
          color: 'var(--fg)',
          border: '1px solid #2a3543',
          // 16px: iOS Safari zooms the page on focus for anything smaller.
          fontSize: 16,
          marginBottom: 8,
        }}
      />

      {active &&
        (matches.length > 0 ? (
          <>
            <p style={{ color: '#2ecc71', fontWeight: 700 }}>✓ In the game:</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {matches.slice(0, SHOWN).map((school) => (
                <li key={school} style={matchRow}>
                  {school}
                </li>
              ))}
            </ul>
            {matches.length > SHOWN && (
              <p style={{ opacity: 0.6, fontSize: 13 }}>
                …and {matches.length - SHOWN} more. Keep typing to narrow it
                down.
              </p>
            )}
          </>
        ) : (
          <>
            <p style={{ color: '#e67e22', fontWeight: 600, marginBottom: 6 }}>
              Not in the game (yet).
            </p>
            <p style={{ marginTop: 0, opacity: 0.7, fontSize: 13 }}>
              This looks up the school’s name, not its town — try the school if
              you typed a town.
            </p>
            {onRequest ? (
              <button
                type="button"
                onClick={() => onRequest(requestMessage)}
                style={{ ...requestLink, border: 'none', cursor: 'pointer' }}
              >
                + Request to add it
              </button>
            ) : (
              <a
                href={requestUrl}
                target="_blank"
                rel="noreferrer"
                style={requestLink}
              >
                + Request to add it
              </a>
            )}
          </>
        ))}
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

const matchRow: CSSProperties = {
  padding: '8px 10px',
  background: '#11202e',
  border: '1px solid #1d2b3a',
  borderRadius: 8,
  marginBottom: 6,
}
