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

import { useEffect, useState, type CSSProperties } from 'react'
import type { GameState, Guess, Town, RoundResult } from '../types'
import { MapGuess } from './MapGuess'
import { Results } from './Results'
import { scoreGuess, formatDistance, totalScore } from '../lib/scoring'
import { playScoreSound } from '../lib/sound'
import { log } from '../lib/log'
import { loadState, saveState, STORAGE_VERSION } from '../lib/storage'
import { resolveInitialGame } from '../lib/resume'
import { lineupHash, recordCompletion } from '../lib/progress'
import { schoolsLine } from '../lib/schools'

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
}

export function Game({
  storageId,
  dateKey,
  bounds,
  towns,
  official,
}: GameProps) {
  // One read of saved state at mount, shared by both the game + streak init.
  const [initial] = useState(() => loadState(storageId))
  const [game, setGame] = useState<GameState>(() =>
    resolveInitialGame(initial.current, dateKey, towns),
  )
  const [guess, setGuess] = useState<Guess | null>(null)
  const [streak, setStreak] = useState(initial.streak)

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

  function submitGuess() {
    if (game.phase !== 'guessing' || !guess) return
    const { distanceMeters, score } = scoreGuess(currentTown, guess)
    log.info('Game', 'guess submitted', {
      round: game.roundIndex + 1,
      town: currentTown.id,
      distanceMeters: Math.round(distanceMeters),
      score,
    })
    playScoreSound(score)
    const result: RoundResult = {
      town: currentTown,
      guess,
      distanceMeters,
      score,
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
      }
      setGuess(null)
      setGame(next)
      persist(next)
    }
  }

  if (game.phase === 'finished') {
    return (
      <Results
        dateKey={game.dateKey}
        results={game.results}
        totalScore={total}
        streak={streak}
        official={official}
      />
    )
  }

  const revealed = game.phase === 'revealed'

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
          Round {game.roundIndex + 1} of {game.towns.length}
        </span>
        <span style={{ opacity: 0.7 }}>
          Score {total.toLocaleString('en-US')}
        </span>
      </div>

      <h2 style={{ margin: '8px 0 2px' }}>
        Where is {currentTown.name}
        {revealed ? `, ${currentTown.state}` : ''}?
      </h2>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        {schoolsLine(currentTown.schools)}
      </p>
      <p style={{ marginTop: 0, fontSize: 14, opacity: 0.6 }}>
        {revealed
          ? 'The green marker is the real spot.'
          : 'Tap the map where you think it is, then submit.'}
      </p>

      <MapGuess
        bounds={bounds}
        guess={guess}
        onGuessChange={setGuess}
        locked={revealed}
        resetViewKey={game.roundIndex}
        reveal={
          revealed && lastResult
            ? {
                town: lastResult.town,
                distanceMeters: lastResult.distanceMeters,
              }
            : null
        }
      />

      {revealed && lastResult ? (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 8px' }}>
            <strong>{formatDistance(lastResult.distanceMeters)}</strong> away ·{' '}
            <strong>{lastResult.score.toLocaleString('en-US')}</strong> pts
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
