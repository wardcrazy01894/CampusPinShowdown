/**
 * Game — orchestrates the 5-round daily flow for the selected towns.
 *
 * Flow per round:
 *   1. Show the town NAME + its school(s). The STATE is withheld. phase = 'guessing'.
 *   2. Player places a pin on <MapGuess/> and hits "Submit guess".
 *   3. Compute distance+score, phase = 'revealed': MapGuess shows truth + line,
 *      and the state is finally shown.
 *   4. After the last round, phase = 'finished' → render <Results/>.
 *
 * Persistence: resume today's in-progress (or finished) game from localStorage;
 * persist on every transition; update the streak when the day finishes. A
 * finished game stays in `current` on purpose (see storage.ts).
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { GameState, Guess, Town, RoundResult } from '../types'
import { MapGuess } from './MapGuess'
import { Results } from './Results'
import {
  scoreGuess,
  formatDistance,
  totalScore,
  HINT_PENALTY,
} from '../lib/scoring'
import { playScoreSound } from '../lib/sound'
import { log } from '../lib/log'
import { loadState, saveState, STORAGE_VERSION } from '../lib/storage'
import { resolveInitialGame } from '../lib/resume'
import { lineupHash, recordCompletion } from '../lib/progress'
import { schoolsLine, promptSchool } from '../lib/schools'
import { revealTag } from '../lib/easterEgg'
import { hintText } from '../lib/hintRegions'
import { tierLabel } from '../lib/tiers'

export interface GameProps {
  /** Storage namespace — the official daily or an isolated dev mode (mode.ts). */
  storageId: string
  /** Calendar date key (YYYY-MM-DD). */
  dateKey: string
  /** Map play bounds, [[south, west], [north, east]]. */
  bounds: [[number, number], [number, number]]
  /** The 5 towns selected for today (from selectDailyTowns). */
  towns: Town[]
  /** True only for the official daily challenge. */
  official: boolean
  /** Called with the phase on mount and every transition (App hides the town
   *  search until the day is finished — mid-round it would answer the round). */
  onPhaseChange?: (phase: GameState['phase']) => void
}

export function Game({
  storageId,
  dateKey,
  bounds,
  towns,
  official,
  onPhaseChange,
}: GameProps) {
  // One read of saved state at mount, shared by both the game + streak init.
  const [initial] = useState(() => loadState(storageId))
  const [game, setGame] = useState<GameState>(() =>
    resolveInitialGame(initial.current, dateKey, towns),
  )
  // Resuming mid-reveal (reload after submit, before "Next round"): restore
  // the submitted pin so the map frames guess + truth + line, not truth alone.
  const [guess, setGuess] = useState<Guess | null>(() =>
    game.phase === 'revealed'
      ? (game.results[game.results.length - 1]?.guess ?? null)
      : null,
  )
  const [streak, setStreak] = useState(initial.streak)

  useEffect(() => {
    onPhaseChange?.(game.phase)
  }, [game.phase, onPhaseChange])

  useEffect(() => {
    const resumed = game.phase !== 'guessing' || game.results.length > 0
    log.info('Game', resumed ? 'resumed today’s game' : 'started new game', {
      dateKey,
      round: game.roundIndex + 1,
      phase: game.phase,
    })
    // Log once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentTown = game.towns[game.roundIndex]
  const lastResult: RoundResult | undefined =
    game.results[game.results.length - 1]
  const total = totalScore(game.results)
  const isLastRound = game.roundIndex === game.towns.length - 1

  /** Persist the game; on finalize, also record the day + bump the streak. */
  function persist(next: GameState, finalize = false) {
    const p = loadState(storageId)
    let history = p.history
    let st = p.streak
    if (finalize) {
      // Each distinct (date, lineup) completion is its own record; the streak
      // bumps once per calendar date. See progress.ts:recordCompletion.
      const folded = recordCompletion(p.history, p.streak, {
        dateKey: next.dateKey,
        lineup: lineupHash(next.towns),
        totalScore: totalScore(next.results),
        results: next.results.map((r) => ({
          distanceMeters: r.distanceMeters,
          score: r.score,
        })),
      })
      history = folded.history
      st = folded.streak
      setStreak(st)
    }
    saveState(storageId, {
      version: STORAGE_VERSION,
      current: next,
      history,
      streak: st,
    })
  }

  /** Reveal the REGION (3–6 neighbouring states, never the one state) for
   *  this round; costs HINT_PENALTY on submit. Persisted immediately so a
   *  reload keeps both the hint and the penalty. */
  function useHint() {
    if (game.phase !== 'guessing' || game.hintUsed) return
    log.info('Game', 'hint used', {
      round: game.roundIndex + 1,
      town: currentTown.id,
    })
    const next: GameState = { ...game, hintUsed: true }
    setGame(next)
    persist(next)
  }

  function submitGuess() {
    if (game.phase !== 'guessing' || !guess) return
    const hinted = !!game.hintUsed
    const { distanceMeters, score } = scoreGuess(currentTown, guess, { hinted })
    log.info('Game', 'guess submitted', {
      round: game.roundIndex + 1,
      town: currentTown.id,
      distanceMeters: Math.round(distanceMeters),
      score,
      hinted,
    })
    playScoreSound(score)
    const result: RoundResult = {
      town: currentTown,
      guess,
      distanceMeters,
      score,
      ...(hinted ? { hinted: true } : {}),
    }
    const next: GameState = {
      ...game,
      results: [...game.results, result],
      phase: 'revealed',
    }
    setGame(next)
    persist(next)
  }

  function advance() {
    if (game.phase !== 'revealed') return
    if (isLastRound) {
      const next: GameState = { ...game, phase: 'finished' }
      log.info('Game', 'day finished', { dateKey, totalScore: total })
      setGame(next)
      persist(next, true)
    } else {
      const next: GameState = {
        ...game,
        roundIndex: game.roundIndex + 1,
        phase: 'guessing',
        hintUsed: false,
      }
      setGuess(null)
      setGame(next)
      persist(next)
    }
  }

  const revealed = game.phase === 'revealed'
  // Hooks must run unconditionally, so this sits above the finished-return.
  // Memoised so MapGuess's reveal effect (keyed on this object) runs once per
  // reveal, not on every Game re-render (which would re-fitBounds under the
  // player while they pan around the reveal).
  const reveal = useMemo(
    () =>
      revealed && lastResult
        ? { town: lastResult.town, distanceMeters: lastResult.distanceMeters }
        : null,
    [revealed, lastResult],
  )

  if (game.phase === 'finished') {
    return (
      <Results
        dateKey={game.dateKey}
        bounds={bounds}
        lineup={lineupHash(game.towns)}
        results={game.results}
        totalScore={total}
        streak={streak}
        official={official}
      />
    )
  }

  return (
    <section style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <span style={{ opacity: 0.7 }}>
          Round {game.roundIndex + 1} of {game.towns.length}{' '}
          {/* Tier up front sets expectations; it says nothing about the town. */}
          <span style={tierBadge}>{tierLabel(currentTown.difficulty)}</span>
        </span>
        <span style={{ opacity: 0.7 }}>
          Score {total.toLocaleString('en-US')}
        </span>
      </div>

      {/* The prompt is the SCHOOL; the town is the answer and is withheld until
          the guess is in (owner rule: "ask where Texas Tech is, then tell me
          it's Lubbock"). */}
      {revealed ? (
        <>
          <h2 style={{ margin: '8px 0 2px' }}>
            {currentTown.name}, {currentTown.state}
            {revealTag(currentTown) && (
              // Only after the reveal — never a hint. See lib/easterEgg.ts.
              <span style={{ marginLeft: 8, fontSize: 16, color: '#ffcb05' }}>
                {revealTag(currentTown)}
              </span>
            )}
          </h2>
          <p style={{ marginTop: 0, opacity: 0.8 }}>
            {schoolsLine(currentTown.schools)}
          </p>
        </>
      ) : (
        <>
          <h2 style={{ margin: '8px 0 2px' }}>
            Where is {promptSchool(currentTown)}?
          </h2>
          <p style={{ marginTop: 0, opacity: 0.8 }}>
            Pin the town it calls home.
            {/* Hint: the state is withheld by design (PLAN §Game loop); the
                player can buy the REGION for HINT_PENALTY points this round. */}{' '}
            {game.hintUsed ? (
              <span style={{ color: '#ffcb05' }}>
                💡 It’s in {hintText(currentTown.stateCode)} · −{HINT_PENALTY}{' '}
                pts
              </span>
            ) : (
              <button type="button" onClick={useHint} style={hintButton}>
                💡 Reveal the region (−{HINT_PENALTY} pts)
              </button>
            )}
          </p>
        </>
      )}
      <p style={{ marginTop: 0, fontSize: 14, opacity: 0.6 }}>
        {revealed
          ? 'The green marker is the real town.'
          : 'Tap the map where you think it is, then submit.'}
      </p>

      <MapGuess
        bounds={bounds}
        guess={guess}
        onGuessChange={setGuess}
        locked={revealed}
        resetViewKey={game.roundIndex}
        reveal={reveal}
      />

      {revealed && lastResult ? (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 8px' }}>
            <strong>{formatDistance(lastResult.distanceMeters)}</strong> away ·{' '}
            <strong>{lastResult.score.toLocaleString('en-US')}</strong> pts
            {lastResult.hinted && (
              <span style={{ opacity: 0.7 }}>
                {' '}
                · 💡 hint used (−{HINT_PENALTY})
              </span>
            )}
          </p>
          <button onClick={advance} style={primaryButton}>
            {isLastRound ? 'See results' : 'Next round'}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={submitGuess}
            disabled={!guess}
            style={{ ...primaryButton, opacity: guess ? 1 : 0.5 }}
          >
            Submit guess
          </button>
        </div>
      )}
    </section>
  )
}

const hintButton: CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255,203,5,0.5)',
  borderRadius: 999,
  color: '#ffcb05',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13,
  padding: '2px 10px',
}

const tierBadge: CSSProperties = {
  marginLeft: 6,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 13,
  background: 'rgba(255,255,255,0.08)',
}

const primaryButton: CSSProperties = {
  padding: '10px 16px',
  fontSize: 16,
  fontWeight: 600,
  borderRadius: 8,
  border: 'none',
  background: '#f4b400',
  color: '#0f1720',
  cursor: 'pointer',
}
