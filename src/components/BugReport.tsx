/**
 * BugReport — type what went wrong, hit send, stay on the site. With a bug
 * endpoint configured (VITE_BUG_ENDPOINT → worker/bug-report.mjs) it files a
 * GitHub issue directly; otherwise it opens a prefilled GitHub issue page.
 *
 * If VITE_TURNSTILE_SITEKEY is set, a Cloudflare Turnstile bot check is shown
 * and its token sent (the worker verifies it). Logs are attached only if the
 * player leaves the checkbox on — the report becomes a public issue, so the
 * form warns against pasting sensitive info. Ported from KnowYourCity.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { submitBugReport, type ReportContext } from '../lib/report'
import { log } from '../lib/log'

type Status = 'idle' | 'sending' | 'done' | 'error'

const TURNSTILE_KEY = import.meta.env.VITE_TURNSTILE_SITEKEY

interface TurnstileApi {
  render: (el: HTMLElement, opts: { sitekey: string }) => string
  remove: (id: string) => void
  reset: (id?: string) => void
  getResponse: (id?: string) => string | undefined
}
function getTurnstileToken(widgetId?: string): string | undefined {
  const w = window as unknown as { turnstile?: TurnstileApi }
  return w.turnstile?.getResponse(widgetId)
}

/** Reset the Turnstile widget so a retry gets a FRESH (single-use) token.
 *  Best-effort: a no-op if Turnstile isn't loaded, never throws. */
export function resetTurnstile(widgetId?: string): void {
  const w = window as unknown as { turnstile?: TurnstileApi }
  try {
    w.turnstile?.reset(widgetId)
  } catch {
    // Widget may already be gone / not yet rendered — nothing to reset.
  }
}

export function BugReport({
  onClose,
  context,
  initialMessage = '',
}: {
  onClose: () => void
  context: ReportContext
  /** Prefill the textarea (e.g. a "please add this town" request). */
  initialMessage?: string
}) {
  const [message, setMessage] = useState(initialMessage)
  const [includeLogs, setIncludeLogs] = useState(true)
  const [status, setStatus] = useState<Status>('idle')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const widgetRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | undefined>(undefined)

  // Escape closes the overlay (it has no backdrop to click).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Explicit Turnstile render per mount (the form is unmounted on close, so
  // implicit auto-render would miss the second open); removed on unmount.
  useEffect(() => {
    if (!TURNSTILE_KEY) return
    const sitekey: string = TURNSTILE_KEY
    let cancelled = false
    let pollTimer: ReturnType<typeof setInterval> | undefined

    const scriptId = 'cf-turnstile-script'
    if (!document.getElementById(scriptId)) {
      const s = document.createElement('script')
      s.id = scriptId
      s.src =
        'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true
      s.defer = true
      document.head.appendChild(s)
    }

    function tryRender(): boolean {
      if (cancelled) return true
      const w = window as unknown as { turnstile?: TurnstileApi }
      if (!w.turnstile || !widgetRef.current) return false
      if (widgetIdRef.current === undefined) {
        widgetIdRef.current = w.turnstile.render(widgetRef.current, {
          sitekey,
        })
      }
      return true
    }

    if (!tryRender()) {
      pollTimer = setInterval(() => {
        if (tryRender() && pollTimer) clearInterval(pollTimer)
      }, 150)
    }

    return () => {
      cancelled = true
      if (pollTimer) clearInterval(pollTimer)
      const w = window as unknown as { turnstile?: TurnstileApi }
      if (widgetIdRef.current !== undefined) {
        try {
          w.turnstile?.remove(widgetIdRef.current)
        } catch {
          // Widget may already be gone; nothing to clean up.
        }
        widgetIdRef.current = undefined
      }
    }
  }, [])

  async function send() {
    if (!message.trim() || status === 'sending') return
    const turnstileToken = TURNSTILE_KEY
      ? getTurnstileToken(widgetIdRef.current)
      : undefined
    if (TURNSTILE_KEY && !turnstileToken) {
      setStatus('error')
      return
    }
    setStatus('sending')
    try {
      const res = await submitBugReport(message, context, {
        includeLogs,
        turnstileToken,
      })
      if (res.ok) {
        // Only render the link if it's actually a github.com issue URL.
        const safe =
          res.url && res.url.startsWith('https://github.com/') ? res.url : null
        setResultUrl(safe)
        setStatus('done')
        log.info('BugReport', 'report sent', { url: safe })
      } else if (res.fallbackUrl) {
        log.info('BugReport', 'no endpoint; opening prefilled issue')
        window.open(res.fallbackUrl, '_blank', 'noopener')
        setStatus('done')
      } else {
        if (TURNSTILE_KEY) resetTurnstile(widgetIdRef.current)
        setStatus('error')
      }
    } catch (e) {
      log.error('BugReport', 'submit failed', { error: String(e) })
      if (TURNSTILE_KEY) resetTurnstile(widgetIdRef.current)
      setStatus('error')
    }
  }

  return (
    <main style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
      <button onClick={onClose} style={link}>
        ← back
      </button>

      <h2 style={{ margin: '8px 0 4px' }}>🐛 Report a bug</h2>

      {status === 'done' ? (
        <div>
          <p style={{ color: '#2ecc71', fontWeight: 700 }}>
            Thanks! Your report was sent.
          </p>
          {resultUrl && (
            <p>
              <a href={resultUrl} target="_blank" rel="noreferrer">
                View the issue ↗
              </a>
            </p>
          )}
          <button onClick={onClose} style={btn}>
            Done
          </button>
        </div>
      ) : (
        <>
          <p style={{ marginTop: 0, opacity: 0.75 }}>
            Tell us what happened — what you did and what went wrong. Or ask for
            a town to be added.
          </p>
          <textarea
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            placeholder="e.g. The map didn't load on round 3, just a black box."
            style={textarea}
          />

          <label
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              fontSize: 14,
              marginTop: 8,
            }}
          >
            <input
              type="checkbox"
              checked={includeLogs}
              onChange={(e) => setIncludeLogs(e.target.checked)}
            />
            Attach diagnostic info (page, browser, recent actions) — helps
            debugging
          </label>
          <p style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
            Your report is sent to the project’s public issue tracker. Please
            don’t include personal or sensitive info.
          </p>

          {TURNSTILE_KEY && <div ref={widgetRef} style={{ marginTop: 8 }} />}

          {status === 'error' && (
            <p style={{ color: '#e74c3c' }}>
              {TURNSTILE_KEY
                ? 'Couldn’t send — complete the check and try again.'
                : 'Couldn’t send — please try again in a moment.'}
            </p>
          )}
          <button
            onClick={send}
            disabled={!message.trim() || status === 'sending'}
            style={{ ...btn, opacity: message.trim() ? 1 : 0.5 }}
          >
            {status === 'sending' ? 'Sending…' : 'Send report'}
          </button>
        </>
      )}
    </main>
  )
}

const link: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#7fb2ff',
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
}
const textarea: CSSProperties = {
  width: '100%',
  padding: 10,
  borderRadius: 8,
  background: '#0b1118',
  color: 'var(--fg)',
  border: '1px solid #2a3543',
  font: 'inherit',
  resize: 'vertical',
}
const btn: CSSProperties = {
  marginTop: 12,
  padding: '10px 16px',
  fontSize: 16,
  fontWeight: 600,
  borderRadius: 8,
  border: 'none',
  background: '#f4b400',
  color: '#0f1720',
  cursor: 'pointer',
}
