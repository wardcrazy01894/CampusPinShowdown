// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react'
import { App } from './App'
import type { Town, TownsFile } from './types'
import { dailyLineup, getDateKey } from './lib/daily'
import { lineupHash } from './lib/progress'
import { loadState, saveState, defaultState } from './lib/storage'
import { loadAccount, saveAccount } from './lib/account'

/**
 * Accounts in the app shell: the header entry point, and the cross-device
 * story — sign in on a second device and today's daily, finished on the
 * first, is already done here with its score, and the streak is the account's.
 */

const town = (
  name: string,
  st: string,
  state: string,
  difficulty: Town['difficulty'],
): Town => ({
  id: `${name.toLowerCase().replace(/\s+/g, '-')}-${st.toLowerCase()}`,
  name,
  state,
  stateCode: st,
  schools: [`University of ${name}`],
  lat: 40,
  lng: -90,
  difficulty,
  source: 'manual',
  attribution: 't',
})

const FILE: TownsFile = {
  version: 1,
  region: 'usa',
  attribution: 'Town coordinates © test',
  towns: [
    town('Ann Arbor', 'MI', 'Michigan', 'easy'),
    town('Athens', 'GA', 'Georgia', 'easy'),
    town('Boulder', 'CO', 'Colorado', 'easy'),
    town('Oxford', 'OH', 'Ohio', 'medium'),
    town('Boone', 'NC', 'North Carolina', 'medium'),
    town('Gambier', 'OH', 'Ohio', 'hard'),
    town('Grinnell', 'IA', 'Iowa', 'hard'),
  ],
}

const ENDPOINT = 'https://lb.example'
const TOKEN = 'f'.repeat(48)
const AL = { token: TOKEN, username: 'spicy_al', name: 'Spicy Al' }
const TODAY = getDateKey(new Date())
const LINEUP = lineupHash(dailyLineup(FILE.towns, 'usa', TODAY))

/** What the worker answers on /me; each test sets it. */
let me: { status: number; body: object }
let posts: { url: string; body: Record<string, unknown> }[]

beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', ENDPOINT)
  posts = []
  me = {
    status: 200,
    body: { ok: true, username: 'spicy_al', name: 'Spicy Al', streak: null },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (!u.startsWith(ENDPOINT))
        return { ok: true, status: 200, json: async () => FILE }
      if (init?.method === 'POST')
        posts.push({ url: u, body: JSON.parse(String(init.body)) })
      if (u.endsWith('/me'))
        return {
          ok: me.status === 200,
          status: me.status,
          json: async () => me.body,
        }
      // Score submit / board read.
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, rank: 1, total: 1, scores: [] }),
        text: async () => '',
      }
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('App — account entry point', () => {
  it('offers sign-in from the header and opens the account dialog', async () => {
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    fireEvent.click(
      screen.getByRole('button', { name: /sign in \/ create account/ }),
    )
    expect(screen.getByRole('dialog', { name: 'Your account' })).toBeTruthy()
    // The game underneath stays mounted.
    expect(screen.getByText(/Round 1 of 5/)).toBeTruthy()
  })

  it('keeps a seat for it on the slim phone header', async () => {
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    const icon = screen.getByRole('button', { name: 'Sign in' })
    expect(icon.classList.contains('icon-button--compact')).toBe(true)
  })

  it('has no account UI when there is no leaderboard worker', async () => {
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', '')
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull()
  })

  it('shows the display name when signed in', async () => {
    saveAccount(AL)
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    expect(screen.getByRole('button', { name: /👤 Spicy Al/ })).toBeTruthy()
  })
})

describe('App — cross-device sync', () => {
  it('a daily finished on another device is already done here, with its score and the account streak', async () => {
    saveAccount(AL)
    me.body = {
      ...me.body,
      streak: { current: 12, best: 12, last: TODAY },
      days: [
        {
          date: TODAY,
          lineup: LINEUP,
          score: 400,
          rounds: [
            [40, -90, 100, 0],
            [40.5, -90, 90, 0],
            [41, -90, 80, 1],
            [41.5, -90, 70, 0],
            [42, -90, 60, 0],
          ],
        },
      ],
    }
    render(<App />)
    expect(await screen.findByText(/Done for today!/)).toBeTruthy()
    expect(screen.getByText('400')).toBeTruthy()
    expect(screen.getByText(/Streak 12 \(best 12\)/)).toBeTruthy()
    // And it is saved, so a reload (even offline) still shows it.
    const saved = loadState('usa')
    expect(saved.current?.phase).toBe('finished')
    expect(saved.streak).toEqual({
      current: 12,
      best: 12,
      lastPlayedDateKey: TODAY,
    })
    // The token went in a POST body, never a URL.
    const call = posts.find((p) => p.url.endsWith('/me'))!
    expect(call.body.token).toBe(TOKEN)
  })

  it('vouches for this device’s own streak so the account can inherit it', async () => {
    saveAccount(AL)
    saveState('usa', {
      ...defaultState(),
      streak: { current: 7, best: 9, lastPlayedDateKey: TODAY },
    })
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    await waitFor(() =>
      expect(posts.find((p) => p.url.endsWith('/me'))?.body.streak).toEqual({
        current: 7,
        best: 9,
        last: TODAY,
      }),
    )
  })

  it('leaves a game alone when the account has nothing new', async () => {
    saveAccount(AL)
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    await waitFor(() =>
      expect(posts.some((p) => p.url.endsWith('/me'))).toBe(true),
    )
    expect(screen.getByText(/Round 1 of 5/)).toBeTruthy()
  })

  it('signs the device out when the server no longer knows the session', async () => {
    saveAccount(AL)
    me = { status: 401, body: { error: 'signed out' } }
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    expect(
      await screen.findByRole('button', { name: /sign in \/ create account/ }),
    ).toBeTruthy()
    expect(loadAccount()).toBeNull()
  })

  it('does not sync a ?shuffle session', async () => {
    saveAccount(AL)
    window.history.replaceState(null, '', '/?shuffle')
    try {
      render(<App />)
      await screen.findByText(/Round 1 of 5/)
      await new Promise((r) => setTimeout(r, 20))
      expect(posts.some((p) => p.url.endsWith('/me'))).toBe(false)
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })
})

describe('App — whose save', () => {
  it('stamps the save with the account, and playing on keeps the stamp', async () => {
    saveAccount(AL)
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    await waitFor(() => expect(loadState('usa').owner).toBe('spicy_al'))
    // Any game transition rewrites the save; the stamp must survive it.
    fireEvent.click(screen.getByRole('button', { name: /Reveal the region/ }))
    expect(loadState('usa').current?.hintUsed).toBe(true)
    expect(loadState('usa').owner).toBe('spicy_al')
  })
})

describe('App — signing out', () => {
  const signOut = async (label = 'Sign out') => {
    fireEvent.click(screen.getByRole('button', { name: /👤 Spicy Al/ }))
    fireEvent.click(await screen.findByRole('button', { name: label }))
  }

  it('saves progress to the account, then returns the device to a fresh anonymous player', async () => {
    saveAccount(AL)
    saveState('usa', {
      ...defaultState(),
      streak: { current: 12, best: 12, lastPlayedDateKey: TODAY },
    })
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    await waitFor(() => expect(posts.length).toBeGreaterThan(0))
    posts.length = 0
    await signOut()
    await waitFor(() => expect(loadAccount()).toBeNull())
    expect(loadState('usa').streak.current).toBe(0)
    // The last word to the server before /logout is the device's streak.
    const routes = posts.map((p) => p.url.split('/').pop())
    expect(routes.indexOf('me')).toBeGreaterThanOrEqual(0)
    expect(routes.indexOf('me')).toBeLessThan(routes.indexOf('logout'))
    expect(posts.find((p) => p.url.endsWith('/me'))?.body.streak).toEqual({
      current: 12,
      best: 12,
      last: TODAY,
    })
  })

  it('does not wipe unsaved progress when the server cannot be reached — unless asked twice', async () => {
    saveAccount(AL)
    saveState('usa', {
      ...defaultState(),
      streak: { current: 12, best: 12, lastPlayedDateKey: TODAY },
    })
    me = { status: 503, body: { error: 'accounts unavailable' } }
    render(<App />)
    await screen.findByText(/Round 1 of 5/)
    await signOut()
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /hasn’t been saved/,
    )
    expect(loadAccount()).not.toBeNull()
    expect(loadState('usa').streak.current).toBe(12)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out anyway' }))
    await waitFor(() => expect(loadAccount()).toBeNull())
    expect(loadState('usa').streak.current).toBe(0)
  })
})
