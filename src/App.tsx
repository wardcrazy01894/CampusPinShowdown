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
import { bugReportUrl } from './lib/report'
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
  const [searching, setSearching] = useState(false)
  // Today's game phase, reported by <Game>. The town search is offered only
  // once the day is FINISHED: mid-round, typing the prompt's school into it
  // would list "Lubbock, TX" — the whole answer. (Review finding on PR #5.)
  const [phase, setPhase] = useState<GamePhase | null>(null)
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

  if (error) return <main style={{ padding: 24 }}>Failed to load: {error}</main>
  if (!file || !today) return <main style={{ padding: 24 }}>Loading…</main>

  return (
    <main>
      {/* Overlay, not a route: the game (and any unsubmitted pin) stays mounted. */}
      {searching && finished && (
        <div style={overlay}>
          <TownSearch towns={file.towns} onClose={() => setSearching(false)} />
        </div>
      )}
      <header
        style={{
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>📍 CampusPin Showdown</h1>
          <small style={{ opacity: 0.7 }}>
            Pin 5 college towns a day · {mode.label}
            {import.meta.env.DEV && (
              <span style={{ color: '#f4b400' }}>
                {' '}
                · dev: ?reset · ?shuffle · ?date=
              </span>
            )}
          </small>
          <div style={{ marginTop: 4, fontSize: 12, display: 'flex', gap: 12 }}>
            {finished && (
              <button onClick={() => setSearching(true)} style={linkButton}>
                🔎 is my town in the game?
              </button>
            )}
            <a
              href={bugReportUrl({ date: mode.dateKey })}
              target="_blank"
              rel="noreferrer"
              style={{ ...linkButton, textDecoration: 'none' }}
            >
              🐛 report a bug
            </a>
          </div>
        </div>
        <button
          onClick={toggleMute}
          aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
          title={muted ? 'Unmute sounds' : 'Mute sounds'}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--fg)',
            fontSize: 20,
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          {muted ? '🔇' : '🔊'}
        </button>
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
          (VIIRS Black Marble; public domain). State outlines: US Census Bureau.
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

const linkButton: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#7fb2ff',
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
}
