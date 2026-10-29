import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { installLogging } from './lib/log'
import { installAnalytics } from './lib/analytics'
import { applyStartupReset } from './lib/storage'
import { resolveMode } from './lib/mode'
import 'leaflet/dist/leaflet.css'
import './index.css'

installLogging(import.meta.env.VITE_APP_VERSION ?? '0.1.0')
// Cloudflare Web Analytics (cookieless page views) — no-op when unset.
installAnalytics(import.meta.env.VITE_CF_BEACON_TOKEN)
// Drop the current game on load when the URL asks (?reset / ?fresh / ?shuffle).
// Default loads persist. Must run before React reads stored state. Scoped to
// the ACTIVE mode's namespace: ?reset clears the official daily's current game
// (history + streak kept), ?shuffle wipes only its own scratch. (The seed only
// affects the selection, not the namespace, so '' is fine here.)
applyStartupReset(resolveMode(window.location.search, new Date(), '').storageId)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
