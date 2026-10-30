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
import { loadState } from './lib/storage'
import type { TownsFile, Town, GamePhase } from './types'
import { getDateKey, selectDailyTowns } from './lib/daily'
import { resolveMode, resolveSessionMode, type Mode } from './lib/mode'
import { REGION, townsUrl } from './lib/region'
import { isMuted, setMuted } from './lib/sound'
import { getBasemap, setBasemap, nextBasemap } from './lib/basemap'
import { BASEMAPS, SATELLITE_YEAR } from './lib/tiles'
import { BugReport } from './components/BugReport'
import { log } from './lib/log'
import { Game } from './components/Game'
import { TownSearch } from './components/TownSearch'

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
  // Night vs satellite imagery — a display preference (lib/basemap.ts), not
  // game state: it never touches the save or the share card.
  const [basemap, setBasemapState] = useState(getBasemap())
  const [searching, setSearching] = useState(false)
  // The in-app bug/request form (an overlay, like the search). `null` =
  // closed; a string = open, prefilled with that text ('' for a blank form).
  const [reporting, setReporting] = useState<string | null>(null)
  // Today's game phase, reported by <Game>. The town search is offered only
  // once the day is FINISHED: mid-round, typing the prompt's school into it
  // would list "Lubbock, TX" — the whole answer. (Review finding on PR #5.)
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

  // Load the dataset once.
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
      const picks = selectDailyTowns(file.towns, mode.selectionSeed)
      log.info('App', 'picks', {
        seed: mode.selectionSeed,
        picks: picks.map((p) => p.id),
      })
      return { picks, error: null }
    } catch (e) {
      log.error('App', 'failed to select towns', { error: String(e) })
      return { picks: null, error: String(e) }
    }
  }, [file, mode.selectionSeed])
  const today = selection.picks
  const error = loadError ?? selection.error

  function toggleMute() {
    const next = !muted
    setMuted(next)
    setMutedState(next)
  }

  function toggleBasemap() {
    const next = nextBasemap(basemap)
    setBasemap(next)
    setBasemapState(next)
    log.info('App', 'basemap', { basemap: next })
  }

  if (error) return <main style={{ padding: 24 }}>Failed to load: {error}</main>
  if (!file || !today) return <main style={{ padding: 24 }}>Loading…</main>

  return (
    <main>
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
      {searching && finished && reporting === null && (
        <div style={overlay}>
          <TownSearch
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
                {finished && (
                  <button
                    onClick={() => setSearching(true)}
                    className="link-button"
                  >
                    🔎 is my town in the game?
                  </button>
                )}
                <button
                  onClick={() => setReporting('')}
                  className="link-button"
                >
                  🐛 report a bug
                </button>
              </div>
            </div>
          </div>
          <div className="header-actions">
            <button
              onClick={toggleBasemap}
              aria-label={`Switch to ${BASEMAPS[nextBasemap(basemap)].label} map`}
              title={`Switch to ${BASEMAPS[nextBasemap(basemap)].label} map`}
              className="icon-button"
            >
              {basemap === 'night' ? '🌃' : '🛰️'}
            </button>
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
        key={mode.selectionSeed}
        storageId={mode.storageId}
        dateKey={mode.dateKey}
        bounds={REGION.bounds}
        towns={today}
        official={mode.official}
        onPhaseChange={setPhase}
        basemap={basemap}
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
