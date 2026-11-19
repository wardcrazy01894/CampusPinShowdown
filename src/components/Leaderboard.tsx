/**
 * Leaderboard — the day's top scores. A signed-in player's row carries their
 * display name; an anonymous one shows the rank and score only (the server
 * never returns ids). We rank them (ties share a rank) and highlight the
 * viewer's own score; if they placed outside the shown top-N their standing is
 * shown as a separate line. Read-only and best-effort: a load failure shows a
 * friendly empty state, never an error that blocks the results screen.
 */

import { useEffect, useState } from 'react'
import { MAX_ROUND_SCORE } from '../lib/scoring'
import { ROUNDS_PER_DAY, puzzleNumber } from '../lib/daily'
import {
  fetchLeaderboard,
  buildLeaderboardRows,
  refreshStanding,
  ordinal,
  type LeaderboardRow,
  type Standing,
} from '../lib/leaderboard'
import { loadAccount } from '../lib/account'

export interface LeaderboardProps {
  dateKey: string
  /** The viewer's BEST total today (the board is one row per device). */
  yourScore?: number
  /** The viewer's standing, for the "you placed Xth" line when off the list. */
  yourStanding?: Standing | null
  onClose: () => void
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'empty' }
  | {
      phase: 'ready'
      rows: LeaderboardRow[]
      total: number
      you: Standing | null
    }

export function Leaderboard({
  dateKey,
  yourScore,
  yourStanding,
  onClose,
}: LeaderboardProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const maxTotal = ROUNDS_PER_DAY * MAX_ROUND_SCORE

  useEffect(() => {
    let live = true
    fetchLeaderboard(dateKey).then((data) => {
      if (!live) return
      if (!data || data.scores.length === 0) {
        setState({ phase: 'empty' })
        return
      }
      const you =
        yourStanding && yourScore !== undefined
          ? refreshStanding(yourStanding, data, yourScore)
          : (yourStanding ?? null)
      setState({
        phase: 'ready',
        // Flag "you" only when we KNOW we're on the board (a standing came
        // back); otherwise a stranger's equal score would be highlighted.
        rows: buildLeaderboardRows(
          data.scores,
          yourStanding && yourScore !== undefined ? [yourScore] : [],
          data.names,
          // Signed in: among tied scores, the row with our own name is ours.
          loadAccount()?.name,
        ),
        total: data.total,
        you,
      })
    })
    return () => {
      live = false
    }
    // One fetch per open; inputs are stable for a given mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const youShown = state.phase === 'ready' && state.rows.some((r) => r.you)

  return (
    // Styled in index.css (`.board*`, `.page`).
    <section className="page board">
      <div className="board__head">
        <h2 className="results__title">
          🏆 Leaderboard{' '}
          <span className="results__num">#{puzzleNumber(dateKey)}</span>
        </h2>
        <button onClick={onClose} className="btn btn--ghost btn--small">
          ← back
        </button>
      </div>
      <p className="board__sub">
        {dateKey}
        {state.phase === 'ready' && (
          <>
            {' · '}
            {state.total.toLocaleString('en-US')}{' '}
            {state.total === 1 ? 'player' : 'players'} today
          </>
        )}
      </p>

      {state.phase === 'loading' && <p className="board__note">Loading…</p>}

      {state.phase === 'empty' && (
        <p className="board__note">
          No scores yet today — be the first to finish!
        </p>
      )}

      {state.phase === 'ready' && (
        <>
          <ol className="board__rows">
            {state.rows.map((r, i) => (
              <li
                key={i}
                className={r.you ? 'board__row board__row--you' : 'board__row'}
              >
                <span className="board__who">
                  {medal(r.rank)} {ordinal(r.rank)}
                  {r.name && <span> · {r.name}</span>}
                  {r.you && <span className="board__you"> · you</span>}
                </span>
                <span className="board__score">
                  {r.score.toLocaleString('en-US')}{' '}
                  <span className="board__max">
                    / {maxTotal.toLocaleString('en-US')}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          {state.total > state.rows.length && (
            <p className="board__more">
              Showing the top {state.rows.length} of{' '}
              {state.total.toLocaleString('en-US')}.
            </p>
          )}
          {!youShown && state.you && (
            <p className="board__placed">
              You placed {ordinal(state.you.rank)} of{' '}
              {state.you.total.toLocaleString('en-US')}
              {yourScore !== undefined &&
                ` · ${yourScore.toLocaleString('en-US')} pts`}
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** A medal for the podium, a bullet otherwise. */
function medal(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return '•'
}
