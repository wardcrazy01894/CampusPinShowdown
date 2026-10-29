/**
 * Results — end-of-day summary + Wordle-style shareable string.
 *
 * Shows total score (x / 500), a per-round breakdown (town, distance, score),
 * current/best streak, and a "Copy result" button. Celebrates a strong finish
 * (confetti + cheer). On the OFFICIAL daily, detects the day rolling over under
 * an open tab and offers "Play today's puzzle" (a reload — day-advance is the
 * player's click, never automatic; see mode.ts:resolveSessionMode).
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { RoundResult } from '../types'
import { MAX_ROUND_SCORE, formatDistance, scoreEmoji } from '../lib/scoring'
import { buildShareString } from '../lib/share'
import { ROUNDS_PER_DAY, getDateKey, puzzleNumber } from '../lib/daily'
import { log } from '../lib/log'
import { shouldCelebrate, countGreens } from '../lib/celebrate'
import { isCelebrateTest } from '../lib/devmode'
import { fireConfetti } from '../lib/confetti'
import { playCheer } from '../lib/sound'
import { tierLabel } from '../lib/tiers'
import { schoolsLine } from '../lib/schools'
import { RecapMap } from './RecapMap'

export interface ResultsProps {
  dateKey: string
  /** Play bounds — the recap map's widest view. */
  bounds: [[number, number], [number, number]]
  results: RoundResult[]
  totalScore: number
  streak: { current: number; best: number }
  /** True only for the official daily challenge — enables the rollover check. */
  official: boolean
}

/**
 * The game's own absolute URL, for the share text. Uses the current origin +
 * Vite `base`, so it's correct on the project page and on a future custom
 * domain without hardcoding.
 */
function shareSiteUrl(): string {
  return window.location.origin + import.meta.env.BASE_URL
}

export function Results({
  dateKey,
  bounds,
  results,
  totalScore,
  streak,
  official,
}: ResultsProps) {
  const [copied, setCopied] = useState(false)
  // Which round the recap map frames; null = the whole day. Tapping a row
  // toggles it.
  const [focus, setFocus] = useState<number | null>(null)
  const mapWrapRef = useRef<HTMLDivElement | null>(null)
  function focusRound(i: number) {
    const next = focus === i ? null : i
    log.debug('Results', 'focus round', { round: next })
    setFocus(next)
    // On a phone the map sits above the rows — bring it back into view
    // (optional chaining: jsdom has no scrollIntoView).
    if (next !== null)
      mapWrapRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      })
  }
  // Day rollover under an open tab — OFFICIAL sessions only: App freezes the
  // official mode across midnight (resolveSessionMode), so advancing is THIS
  // click; the reload re-resolves the mode fresh (and picks up any pending
  // deploy with it). Non-official modes keep their fixed or per-load seed
  // across a reload, so the button would be a lie there.
  const [rolled, setRolled] = useState(false)
  useEffect(() => {
    if (!official) return
    const check = () => setRolled(getDateKey(new Date()) !== dateKey)
    check()
    const t = setInterval(check, 30_000)
    return () => clearInterval(t)
    // official/dateKey are fixed for this mounted results screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Celebrate a strong finish (4+ greens or a total over 400): confetti + a
  // crowd cheer, once when the results screen first mounts. The ref guard makes
  // it fire exactly once even under StrictMode's dev double-mount.
  const celebratedRef = useRef(false)
  useEffect(() => {
    if (celebratedRef.current) return
    const forced = isCelebrateTest(window.location.search)
    if (!forced && !shouldCelebrate(results, totalScore)) return
    celebratedRef.current = true
    log.info('Results', 'celebrating strong finish', {
      greens: countGreens(results),
      totalScore,
    })
    const cancel = fireConfetti()
    playCheer()
    return cancel
    // Fire once on mount; results/totalScore are fixed for this finished day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const maxTotal = ROUNDS_PER_DAY * MAX_ROUND_SCORE
  // Compute once so the copied text and the preview below can never diverge.
  const shareText = buildShareString(
    dateKey,
    results,
    totalScore,
    shareSiteUrl(),
  )

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareText)
      log.info('Results', 'copied share string')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      // Clipboard blocked — no-op; the text is visible below anyway.
      log.warn('Results', 'clipboard copy failed', { error: String(e) })
    }
  }

  return (
    <section style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 4 }}>
        {rolled ? `Done for ${dateKey}!` : 'Done for today!'}{' '}
        <span style={{ opacity: 0.5, fontWeight: 400, fontSize: 16 }}>
          #{puzzleNumber(dateKey)}
        </span>
      </h2>
      {rolled && (
        <button
          onClick={() => window.location.reload()}
          style={playTodayButton}
        >
          ▶ Play today’s puzzle
        </button>
      )}
      <p style={{ fontSize: 28, fontWeight: 700, margin: '4px 0' }}>
        {totalScore.toLocaleString('en-US')}{' '}
        <span style={{ fontSize: 16, opacity: 0.6 }}>
          / {maxTotal.toLocaleString('en-US')}
        </span>
      </p>
      <p style={{ opacity: 0.8, marginTop: 0 }}>
        🔥 Streak {streak.current} (best {streak.best})
      </p>

      {/* Day recap: every round on one map. Never shown mid-day (it would
          answer the remaining rounds) — Results only mounts once finished. */}
      <p style={{ margin: '8px 0 6px', opacity: 0.7, fontSize: 14 }}>
        <span style={{ color: '#2ecc71' }}>●</span> real town ·{' '}
        <span style={{ color: '#f4b400' }}>●</span> your guess · tap a row to
        zoom in
      </p>
      <div ref={mapWrapRef} style={{ scrollMarginTop: 8 }}>
        <RecapMap bounds={bounds} results={results} focus={focus} />
      </div>

      <ol style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
        {results.map((r, i) => {
          const focused = focus === i
          return (
            <li key={`${i}-${r.town.id}`} style={{ marginBottom: 6 }}>
              <button
                type="button"
                onClick={() => focusRound(i)}
                aria-pressed={focused}
                style={{
                  ...rowButton,
                  borderColor: focused ? '#2ecc71' : 'rgba(255,255,255,0.12)',
                  background: focused
                    ? 'rgba(46,204,113,0.10)'
                    : 'rgba(255,255,255,0.04)',
                }}
              >
                <span style={rowBadge}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block' }}>
                    {scoreEmoji(r.score, dateKey)}{' '}
                    <strong>
                      {r.town.name}, {r.town.stateCode}
                    </strong>{' '}
                    — {formatDistance(r.distanceMeters)} ·{' '}
                    {r.score.toLocaleString('en-US')} pts{' '}
                    <span style={{ fontSize: 13, opacity: 0.6 }}>
                      {tierLabel(r.town.difficulty)}
                    </span>
                  </span>
                  <span
                    style={{ display: 'block', fontSize: 13, opacity: 0.7 }}
                  >
                    {schoolsLine(r.town.schools)}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      <div style={{ marginTop: 12 }}>
        <button onClick={copy} style={copyButton}>
          {copied ? 'Copied!' : 'Copy result'}
        </button>
      </div>

      <pre
        style={{
          marginTop: 16,
          padding: 12,
          background: '#0b1118',
          borderRadius: 8,
          whiteSpace: 'pre-wrap',
          fontSize: 14,
        }}
      >
        {shareText}
      </pre>
    </section>
  )
}

const rowButton: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  width: '100%',
  textAlign: 'left',
  padding: '8px 10px',
  border: '1px solid',
  borderRadius: 10,
  color: 'inherit',
  font: 'inherit',
  lineHeight: 1.5,
  cursor: 'pointer',
  transition: 'background 120ms, border-color 120ms',
}

const rowBadge: CSSProperties = {
  flex: '0 0 auto',
  width: 24,
  height: 24,
  marginTop: 2,
  borderRadius: '50%',
  background: '#2ecc71',
  color: '#0f1720',
  fontWeight: 700,
  fontSize: 13,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const copyButton: CSSProperties = {
  padding: '10px 16px',
  fontSize: 16,
  fontWeight: 600,
  borderRadius: 8,
  border: 'none',
  background: '#f4b400',
  color: '#0f1720',
  cursor: 'pointer',
}

const playTodayButton: CSSProperties = {
  ...copyButton,
  fontWeight: 700,
  background: '#2ecc71',
  marginBottom: 8,
}
