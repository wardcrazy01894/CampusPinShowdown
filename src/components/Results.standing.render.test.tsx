// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'

/**
 * DOM-level test for the standing + server streak on the results screen, and
 * for the best-of-device rule: after a changed-set REPLAY that scored LOWER
 * than the first play, every standing computation must speak in the viewer's
 * BEST score (the board is one row per device), or refreshStanding would count
 * the viewer's own better row as a competitor ("2nd of 2" while their row shows
 * rank 1). Network functions are mocked; refreshStanding/formatStanding are REAL.
 */

const { submitDailyScore, fetchLeaderboard } = vi.hoisted(() => ({
  submitDailyScore: vi.fn(async () => ({
    rank: 1,
    total: 2,
    streak: { current: 9, best: 9 },
  })),
  fetchLeaderboard: vi.fn(async () => ({ total: 2, scores: [400, 300] })),
}))
vi.mock('../lib/leaderboard', async (importActual) => ({
  ...(await importActual<typeof import('../lib/leaderboard')>()),
  submitDailyScore,
  fetchLeaderboard,
}))

import { Results } from './Results'
import { REGION } from '../lib/region'
import { saveState, STORAGE_VERSION } from '../lib/storage'
import type { RoundResult } from '../types'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

function result(score: number): RoundResult {
  return {
    town: {
      id: `t-${score}`,
      name: 'X',
      state: 'Ohio',
      stateCode: 'OH',
      schools: ['U'],
      lat: 40,
      lng: -83,
      difficulty: 'easy',
      source: 'manual',
      attribution: 't',
    },
    guess: { lat: 40, lng: -83 },
    distanceMeters: 0,
    score,
  }
}

const five = [result(70), result(70), result(70), result(70), result(70)]

it('a lower-scoring replay still shows the standing of the device’s BEST entry, and the server streak', async () => {
  saveState(REGION.id, {
    version: STORAGE_VERSION,
    current: undefined,
    history: [
      { dateKey: '2026-10-29', lineup: 'aaaa', totalScore: 400, results: [] },
      { dateKey: '2026-10-29', lineup: 'bbbb', totalScore: 350, results: [] },
    ],
    streak: { current: 1, best: 1, lastPlayedDateKey: '2026-10-29' },
  })
  render(
    <Results
      dateKey="2026-10-29"
      bounds={REGION.bounds}
      results={five}
      totalScore={350}
      lineup="bbbb"
      streak={{ current: 1, best: 1 }}
      official={true}
    />,
  )
  expect(await screen.findByText(/1st of 2/)).toBeTruthy()
  // Shown streak is the larger of local (1) and server (9), per field.
  expect(screen.getByText(/Streak 9 \(best 9\)/)).toBeTruthy()
  expect(submitDailyScore).toHaveBeenCalledWith(
    expect.objectContaining({ lineup: 'bbbb', score: 350, official: true }),
  )
})

it('never lets a thin server streak hide a real local one (launch day / missed submit)', async () => {
  render(
    <Results
      dateKey="2026-10-29"
      bounds={REGION.bounds}
      results={five}
      totalScore={350}
      lineup="bbbb"
      streak={{ current: 30, best: 31 }}
      official={true}
    />,
  )
  await screen.findByText(/1st of 2/)
  // Server said { current: 9, best: 9 }; local 30/31 wins field by field.
  expect(screen.getByText(/Streak 30 \(best 31\)/)).toBeTruthy()
})

it('never submits a non-official (shuffle / date override) game', async () => {
  render(
    <Results
      dateKey="2026-10-29"
      bounds={REGION.bounds}
      results={five}
      totalScore={350}
      lineup="bbbb"
      streak={{ current: 1, best: 1 }}
      official={false}
    />,
  )
  // submitDailyScore itself gates on `official`; Results must pass it through.
  expect(submitDailyScore).toHaveBeenCalledWith(
    expect.objectContaining({ official: false }),
  )
  expect(screen.queryByText(/You placed/)).toBeNull()
  expect(screen.getByText(/Streak 1 \(best 1\)/)).toBeTruthy()
})
