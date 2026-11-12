/**
 * App shell: load the town dataset, resolve the play mode (official daily,
 * ?shuffle, ?date=), compute the day's selection, and render the Game.
 *
 * Modes (see src/lib/devmode.ts + mode.ts): normal (today's 5, persists),
 * ?reset (same 5, drop the current game each refresh), ?shuffle (random 5 each
 * refresh), ?date=YYYY-MM-DD (a specific day).
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  fetchRemoteHash,
  versionCheckAction,
  shouldDeferReload,
} from './lib/version'
import { loadState, resetForSignOut } from './lib/storage'
import {
  accountsEnabled,
  loadAccount,
  logout,
  saveAccount,
  type Account,
} from './lib/account'
import { syncProgress } from './lib/sync'
import { shouldStartFresh } from './lib/devmode'
import { AccountDialog } from './components/AccountDialog'
import type { TownsFile, Town, GamePhase } from './types'
import { getDateKey, selectDailyTowns, dailyLineup } from './lib/daily'
import { resolveMode, resolveSessionMode, type Mode } from './lib/mode'
import { REGION, townsUrl } from './lib/region'
import { isMuted, setMuted } from './lib/sound'
import { getBasemap, setBasemap, type Basemap } from './lib/basemap'
import { SATELLITE_YEAR } from './lib/tiles'
import { BugReport } from './components/BugReport'
import { log } from './lib/log'
import { Game } from './components/Game'
import { SchoolSearch } from './components/SchoolSearch'

// Generated once per page load; in ?shuffle mode this seeds a fresh random set.
const SHUFFLE_SEED = Math.random().toString(36).slice(2)

const BUILD_HASH = import.meta.env.VITE_BUILD_HASH ?? 'dev'

async function loadTowns(): Promise<TownsFile> {
  const url = townsUrl()
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Could not load ${url} (HTTP ${r.status})`)
  const file = (await r.json()) as TownsFile
  if (!Array.isArray(file?.towns)) throw new Error(`Malformed ${url}`)
  log.info('App', `loaded ${file.towns.length} towns`)
  return file
}

export function App() {
  const [file, setFile] = useState<TownsFile | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [muted, setMutedState] = useState(isMuted())
  // Satellite vs night imagery — a display preference (lib/basemap.ts), not
  // game state: it never touches the save or the share card. The toggle
  // itself is drawn on the maps (BasemapToggle); App just owns the value.
  const [basemap, setBasemapState] = useState(getBasemap())
  const [searching, setSearching] = useState(false)
  // The in-app bug/request form (an overlay, like the search). `null` =
  // closed; a string = open, prefilled with that text ('' for a blank form).
  const [reporting, setReporting] = useState<string | null>(null)
  // Optional account (lib/account.ts): this device's sign-in, the dialog
  // (an overlay, like the two above), and two counters the sync bumps —
  // `gameEpoch` remounts the Game when today's game was replaced by the one
  // finished on another device; `syncEpoch` tells a mounted Game to re-read
  // the streak.
  const [account, setAccount] = useState<Account | null>(loadAccount)
  const [accountOpen, setAccountOpen] = useState(false)
  const [gameEpoch, setGameEpoch] = useState(0)
  const [syncEpoch, setSyncEpoch] = useState(0)
  const [syncAsk, setSyncAsk] = useState(0)
  // Today's game phase, reported by <Game> — drives the play/results layout
  // (`is-playing`). (It used to gate the school search too, back when that
  // listed towns; the search now shows school names only — lib/search.ts —
  // so it is offered on every screen.)
  const [phase, setPhase] = useState<GamePhase | null>(() => {
    // Seed from the saved game so a resumed finished day is 'finished' on the
    // very first render; Game reports every later transition.
    const m = resolveMode(
      typeof window !== 'undefined' ? window.location.search : '',
      new Date(),
      SHUFFLE_SEED,
    )
    const saved = loadState(m.storageId).current
    // Only a save for THIS day counts — yesterday's finished game is discarded
    // by Game (resolveInitialGame) and must not flash the search for a frame.
    return saved && saved.dateKey === m.dateKey ? saved.phase : null
  })
  const finished = phase === 'finished'

  // Freeze the mounted session's mode across local midnight: re-renders
  // recompute resolveMode with a fresh clock, but a rolled official seed only
  // takes effect when adopting it wouldn't disturb a saved game (mid-round, or
  // sitting on a past day's results) — day-advance stays the player's click
  // (Results shows a "Play today's puzzle" button). See resolveSessionMode.
  const search = typeof window !== 'undefined' ? window.location.search : ''
  // Read/written during render on purpose (react-hooks/refs is staged to
  // `warn` for this): the ref must hold the PREVIOUS render's mode so the
  // freeze can compare seeds before anything else renders.
  const sessionModeRef = useRef<Mode | null>(null)
  const mode = resolveSessionMode(
    sessionModeRef.current,
    resolveMode(search, new Date(), SHUFFLE_SEED),
    () => loadState(REGION.id).current,
  )
  sessionModeRef.current = mode
  // Inline ref — the version-check effect reads the latest storage namespace
  // without re-subscribing, and computes the REAL current date itself so a tab
  // left open past midnight is judged correctly.
  const storageIdRef = useRef(mode.storageId)
  storageIdRef.current = mode.storageId

  // Keep players on the latest deploy automatically — no banner, no click. Poll
  // version.json on tab focus AND on an interval, comparing the build hash
  // embedded at compile time. When it differs we silently reload, EXCEPT when a
  // reload would disrupt the player (see shouldDeferReload): mid-round, or
  // sitting on the results screen after the day has rolled over. In those cases
  // we defer; a later check reloads on its own once it's safe.
  useEffect(() => {
    if (import.meta.env.DEV) return
    const POLL_MS = 5 * 60_000
    let reloadScheduled = false
    async function checkVersion() {
      if (reloadScheduled) return
      const remote = await fetchRemoteHash()
      if (!remote) return
      const defer = shouldDeferReload(
        loadState(storageIdRef.current).current,
        getDateKey(new Date()),
      )
      const action = versionCheckAction(BUILD_HASH, remote, defer)
      if (action === 'noop') return
      log.info('App', 'new deploy detected', {
        local: BUILD_HASH,
        remote,
        action,
      })
      if (action === 'reload') {
        reloadScheduled = true // guard overlapping checks from double-reloading
        window.location.reload()
      }
    }
    function onVisible() {
      if (!document.hidden) void checkVersion()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => void checkVersion(), POLL_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [])

  function changeAccount(next: Account) {
    saveAccount(next)
    setAccount(next)
  }

  /**
   * Sign out. The streak and today's game are the account's, so the device
   * goes back to a fresh anonymous player (storage.ts:resetForSignOut says
   * why) — but first the account gets whatever only this device has (a day
   * finished offline, a streak the server missed). If the server can't be
   * reached for that, nothing is wiped unless the player insists (`force`).
   */
  async function signOut(force: boolean): Promise<'done' | 'unsaved'> {
    if (!account) return 'done'
    if (file) {
      // The official day, whatever mode this tab is in.
      const dateKey = mode.official ? mode.dateKey : getDateKey(new Date())
      const r = await syncProgress({
        token: account.token,
        username: account.username,
        storageId: REGION.id,
        dateKey,
        towns:
          mode.official && today
            ? today
            : dailyLineup(file.towns, REGION.id, dateKey),
      })
      if (r.status === 'offline' && !force) return 'unsaved'
    }
    // Best effort: with no connection the session lingers on the server, but
    // this device is signed out either way.
    await logout(account.token)
    saveAccount(null)
    setAccount(null)
    resetForSignOut(REGION.id)
    setGameEpoch((n) => n + 1)
    log.info('App', 'signed out')
    return 'done'
  }

  // Cross-device sync (lib/sync.ts), signed in only: on load, on signing in,
  // and whenever the tab comes back. Official daily only — a ?shuffle/?date
  // session has nothing of the account's, and ?reset is asking to replay.
  const token = account?.token
  const username = account?.username
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) setSyncAsk((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useEffect(() => {
    let live = true
    loadTowns()
      .then((f) => live && setFile(f))
      .catch((e) => {
        if (!live) return
        log.error('App', 'failed to load towns', { error: String(e) })
        setLoadError(String(e))
      })
    return () => {
      live = false
    }
  }, [])

  // Select the day's towns SYNCHRONOUSLY from (dataset, seed) with useMemo —
  // not in an effect. <Game key={mode.selectionSeed}> remounts on the very
  // render where the seed changes; an effect-driven setState would run one
  // render later, so the new Game would mount (and bake into its state) the
  // PREVIOUS seed's towns under the new dateKey — i.e. yesterday's five
  // played and recorded as today. Memoising makes picks and seed change
  // together. (Review finding on PR #2; render-tested in App.render.test.)
  const selection = useMemo<{
    picks: Town[] | null
    error: string | null
  }>(() => {
    if (!file) return { picks: null, error: null }
    try {
      // Calendar days go through the recency cooldown (no town twice in two
      // weeks); ?shuffle has no history and takes the plain seeded pick.
      const picks = mode.cooldown
        ? dailyLineup(file.towns, REGION.id, mode.dateKey)
        : selectDailyTowns(file.towns, mode.selectionSeed)
      log.info('App', 'picks', {
        seed: mode.selectionSeed,
        picks: picks.map((p) => p.id),
      })
      return { picks, error: null }
    } catch (e) {
      log.error('App', 'failed to select towns', { error: String(e) })
      return { picks: null, error: String(e) }
    }
  }, [file, mode.selectionSeed, mode.cooldown, mode.dateKey])
  const today = selection.picks
  const error = loadError ?? selection.error

  const syncable =
    accountsEnabled() && mode.official && !shouldStartFresh(search)
  useEffect(() => {
    if (!syncable || !token || !username || !today) return
    // No "is this effect still live?" guard on purpose: the save is written
    // either way, so the remount/re-read below must follow it.
    void syncProgress({
      token,
      username,
      storageId: mode.storageId,
      dateKey: mode.dateKey,
      towns: today,
    }).then((r) => {
      if (r.status === 'signed-out') {
        // The server no longer knows this session (signed out there, or pushed
        // out by newer sign-ins). Not the player's choice, so the save is left
        // alone — it stays stamped with its owner, so it is never offered to
        // a different account (sync.ts).
        log.info('App', 'session ended by the server')
        saveAccount(null)
        setAccount((a) => (a?.token === token ? null : a))
        return
      }
      if (r.status !== 'ok') return
      setAccount((a) => {
        if (!a || a.token !== token || !r.username) return a
        if (a.name === r.name && a.username === r.username) return a
        // Renamed on another device.
        const next = { ...a, username: r.username, name: r.name ?? a.name }
        saveAccount(next)
        return next
      })
      if (r.gameReplaced) setGameEpoch((n) => n + 1)
      if (r.changed) setSyncEpoch((n) => n + 1)
    })
  }, [syncable, token, username, today, mode.storageId, mode.dateKey, syncAsk])

  function toggleMute() {
    const next = !muted
    setMuted(next)
    setMutedState(next)
  }

  function changeBasemap(next: Basemap) {
    setBasemap(next)
    setBasemapState(next)
    log.info('App', 'basemap', { basemap: next })
  }

  if (error) return <main style={{ padding: 24 }}>Failed to load: {error}</main>
  if (!file || !today) return <main style={{ padding: 24 }}>Loading…</main>

  return (
    // `is-playing`: the play map takes the screen below the header, the
    // footer hides, and on phones the header slims down (index.css); the
    // results screen gets the full header and footer back.
    <main className={finished ? undefined : 'is-playing'}>
      {/* Overlay, not a route: the game (and any unsubmitted pin) stays mounted. */}
      {reporting !== null && (
        <div style={overlay}>
          <BugReport
            context={{ date: mode.dateKey }}
            initialMessage={reporting}
            onClose={() => setReporting(null)}
          />
        </div>
      )}
      {accountOpen && reporting === null && (
        <div style={overlay}>
          <AccountDialog
            account={account}
            onChange={changeAccount}
            onSignOut={signOut}
            onClose={() => setAccountOpen(false)}
          />
        </div>
      )}
      {searching && reporting === null && !accountOpen && (
        <div style={overlay}>
          <SchoolSearch
            towns={file.towns}
            onClose={() => setSearching(false)}
            onRequest={(message) => {
              setSearching(false)
              setReporting(message)
            }}
          />
        </div>
      )}
      <header className="site-header">
        <div className="site-header__inner">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              <svg viewBox="0 0 64 64" width="34" height="34">
                <rect width="64" height="64" rx="14" fill="var(--accent)" />
                <path
                  d="M32 9c-9.7 0-17.5 7.7-17.5 17.2C14.5 39.4 32 55 32 55s17.5-15.6 17.5-28.8C49.5 16.7 41.7 9 32 9z"
                  fill="var(--bg)"
                />
                <circle cx="32" cy="26" r="6.8" fill="var(--accent)" />
              </svg>
            </span>
            <div>
              <h1 className="brand__title">CampusPin Showdown</h1>
              <div className="tagline">
                <span>Pin 5 college towns a day</span>
                <span className="chip">{mode.label}</span>
                {import.meta.env.DEV && (
                  <span className="chip chip--dev">
                    dev: ?reset · ?shuffle · ?date=
                  </span>
                )}
              </div>
              <div className="header-links">
                <button
                  onClick={() => setSearching(true)}
                  className="link-button"
                >
                  🔎 is my school in the game?
                </button>
                <button
                  onClick={() => setReporting('')}
                  className="link-button"
                >
                  🐛 report a bug
                </button>
                {accountsEnabled() && (
                  <button
                    onClick={() => setAccountOpen(true)}
                    className="link-button"
                  >
                    👤 {account ? account.name : 'sign in / create account'}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="header-buttons">
            {/* Phones hide the header links during play (index.css), so the
                school search, the bug report and the account keep a seat
                here; CSS shows these three only then. */}
            <button
              onClick={() => setSearching(true)}
              aria-label="Is my school in the game?"
              title="Is my school in the game?"
              className="icon-button icon-button--compact"
            >
              🔎
            </button>
            <button
              onClick={() => setReporting('')}
              aria-label="Report a bug"
              title="Report a bug"
              className="icon-button icon-button--compact"
            >
              🐛
            </button>
            {accountsEnabled() && (
              <button
                onClick={() => setAccountOpen(true)}
                aria-label={account ? 'Your account' : 'Sign in'}
                title={account ? `Signed in as ${account.username}` : 'Sign in'}
                className="icon-button icon-button--compact"
              >
                👤
              </button>
            )}
            <button
              onClick={toggleMute}
              aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
              title={muted ? 'Unmute sounds' : 'Mute sounds'}
              className="icon-button"
            >
              {muted ? '🔇' : '🔊'}
            </button>
          </div>
        </div>
      </header>
      <Game
        // Remount on a seed change so a ?shuffle / rollover never carries state.
        // …and when account sync replaced today's game (gameEpoch).
        key={`${mode.selectionSeed}:${gameEpoch}`}
        syncEpoch={syncEpoch}
        signedIn={account !== null}
        onOpenAccount={
          accountsEnabled() ? () => setAccountOpen(true) : undefined
        }
        storageId={mode.storageId}
        dateKey={mode.dateKey}
        bounds={REGION.bounds}
        towns={today}
        official={mode.official}
        onPhaseChange={setPhase}
        basemap={basemap}
        onBasemapChange={changeBasemap}
      />
      <footer
        style={{
          padding: '10px 16px 20px',
          fontSize: 11,
          opacity: 0.55,
          textAlign: 'center',
          lineHeight: 1.7,
        }}
      >
        <div>
          {file.attribution} Night imagery:{' '}
          <a
            href="https://earthdata.nasa.gov/gibs"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'inherit' }}
          >
            NASA GIBS
          </a>{' '}
          (VIIRS Black Marble; public domain). Satellite imagery:{' '}
          <a
            href="https://cloudless.eox.at"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'inherit' }}
          >
            EOxCloudless
          </a>{' '}
          by EOX IT Services GmbH (contains modified Copernicus Sentinel data{' '}
          {SATELLITE_YEAR};{' '}
          <a
            href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'inherit' }}
          >
            CC BY-NC-SA 4.0
          </a>
          ). State outlines: US Census Bureau.
        </div>
        <div>Idea courtesy of good friend Garret B.</div>
        <div>A Spicy Al Software Solution</div>
      </footer>
    </main>
  )
}

/** Above Leaflet's controls (z-index 1000) — belt-and-braces with the
 *  `.map-container { isolation: isolate }` rule in index.css. Exported for the
 *  render test that pins this invariant. */
export const OVERLAY_Z_INDEX = 1100

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: OVERLAY_Z_INDEX,
  overflowY: 'auto',
  background: 'var(--bg)',
}
