// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

const { fetchLeaderboard } = vi.hoisted(() => ({
  fetchLeaderboard: vi.fn(async () => ({ total: 4, scores: [480, 420, 420] })),
}))
vi.mock('../lib/leaderboard', async (importActual) => ({
  ...(await importActual<typeof import('../lib/leaderboard')>()),
  fetchLeaderboard,
}))

import { Leaderboard } from './Leaderboard'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('ranks the board (ties share a rank), highlights the viewer, shows the off-list standing', async () => {
  const onClose = vi.fn()
  render(
    <Leaderboard
      dateKey="2026-10-29"
      yourScore={300}
      yourStanding={{ rank: 4, total: 4 }}
      onClose={onClose}
    />,
  )
  expect(await screen.findByText(/4 players today/)).toBeTruthy()
  expect(screen.getByText(/🥇 1st/)).toBeTruthy()
  expect(screen.getAllByText(/🥈 2nd/)).toHaveLength(2) // tie at 420
  // Viewer's 300 is below the returned window → separate standing line.
  expect(screen.getByText(/You placed 4th of 4 · 300 pts/)).toBeTruthy()
  expect(screen.getByText(/Showing the top 3 of 4/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /back/ }))
  expect(onClose).toHaveBeenCalled()
})

it('does not flag a stranger’s equal score as "you" when the submit failed', async () => {
  render(
    <Leaderboard
      dateKey="2026-10-29"
      yourScore={420}
      yourStanding={null}
      onClose={() => {}}
    />,
  )
  await screen.findByText(/4 players today/)
  expect(screen.queryByText(/· you/)).toBeNull()
})

it('shows a friendly empty state when there is no board', async () => {
  fetchLeaderboard.mockResolvedValueOnce(null as never)
  render(<Leaderboard dateKey="2026-10-29" onClose={() => {}} />)
  expect(await screen.findByText(/No scores yet today/)).toBeTruthy()
})
