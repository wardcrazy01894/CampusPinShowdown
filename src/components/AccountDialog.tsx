/**
 * AccountDialog — create an account, sign in, change the display name, sign
 * out. A thin shell over src/lib/account.ts (ported from WhereHePlay's
 * AccountDialog); rendered by App as a full-screen overlay like the town
 * search and the bug form, so the game underneath stays mounted.
 *
 * An account is a username + password + display name. The sign-up form says
 * plainly that the username is NOT an email (people type one by habit), and
 * the form refuses one before anything is sent.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import {
  type Account,
  friendlyError,
  login,
  passwordProblem,
  register,
  setDisplayName,
  usernameProblem,
} from '../lib/account'

export interface AccountDialogProps {
  /** This device's sign-in, or null when signed out. */
  account: Account | null
  /** Signed in or renamed. App persists it. */
  onChange: (next: Account) => void
  /**
   * Sign this device out (App: save progress to the account, end the
   * session, reset the device). Resolves 'unsaved' — and does NOT sign out —
   * when the server could not be reached to save progress first and `force`
   * is false; the dialog then asks once more.
   */
  onSignOut?: (force: boolean) => Promise<'done' | 'unsaved'>
  onClose: () => void
}

type Form = 'none' | 'register' | 'login'

export function AccountDialog({
  account,
  onChange,
  onSignOut,
  onClose,
}: AccountDialogProps) {
  // True after a sign-out was held back because progress could not be saved.
  const [unsaved, setUnsaved] = useState(false)
  const [form, setForm] = useState<Form>('none')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState(account?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  // Escape closes the overlay (it has no backdrop to click).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Run one action; it resolves to an error sentence, or nothing on success. */
  async function run(action: () => Promise<string | void>, done: string) {
    setBusy(true)
    setError('')
    setNote('')
    try {
      const problem = await action()
      if (problem) setError(problem)
      else setNote(done)
    } finally {
      setBusy(false)
    }
  }

  const submit = () =>
    run(
      async () => {
        const problem =
          form === 'register'
            ? (usernameProblem(username) ?? passwordProblem(password))
            : !username.trim() || !password
              ? 'Enter your username and password.'
              : null
        if (problem) return problem
        const r =
          form === 'register'
            ? await register(username, password, name)
            : await login(username, password)
        if (!r.ok)
          return form === 'register' && r.status === 409
            ? // Also what a retry sees if the first try did create it.
              `${friendlyError(r)} If it’s yours, use Sign in instead.`
            : friendlyError(r)
        setPassword('')
        setName(r.name)
        setForm('none')
        onChange({ token: r.token, username: r.username, name: r.name })
      },
      form === 'register'
        ? 'Account created. Your streak comes with you.'
        : 'Signed in. Your streak and today’s result are syncing.',
    )

  const saveName = () =>
    run(async () => {
      if (!account) return
      const r = await setDisplayName(account.token, name)
      if (!r.ok) return friendlyError(r)
      setName(r.name)
      onChange({ ...account, name: r.name })
    }, 'Saved.')

  const signOut = () =>
    run(async () => {
      if (!account || !onSignOut) return
      if ((await onSignOut(unsaved)) === 'unsaved') {
        setUnsaved(true)
        return 'Couldn’t reach the server, so this device’s latest progress hasn’t been saved to your account. Try again when you’re online — or sign out anyway and lose it.'
      }
      setUnsaved(false)
      setName('')
    }, 'Signed out.')

  return (
    <main
      role="dialog"
      aria-modal="true"
      aria-label="Your account"
      style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}
    >
      <button onClick={onClose} style={linkButton}>
        ← back
      </button>
      <h2 style={{ margin: '8px 0 4px' }}>Your account</h2>

      {account ? (
        <>
          <p style={{ marginTop: 0, opacity: 0.8 }}>
            Signed in as <strong>{account.username}</strong>. Your streak and
            today’s result follow this account on every device you sign in to.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void saveName()
            }}
          >
            <label style={field}>
              <span>Display name</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={name}
                  maxLength={20}
                  autoComplete="nickname"
                  onChange={(e) => setName(e.target.value)}
                  style={{ ...input, flex: 1 }}
                />
                <button type="submit" disabled={busy} style={primary}>
                  Save
                </button>
              </span>
              <span style={hint}>
                Shown next to your score on the leaderboard. 2 to 20 characters.
              </span>
            </label>
          </form>
          <button
            type="button"
            disabled={busy}
            onClick={signOut}
            style={secondary}
          >
            {unsaved ? 'Sign out anyway' : 'Sign out'}
          </button>
          <p style={hint}>
            Signing out returns this device to a fresh anonymous player. Your
            streak stays with your account and comes back when you sign in.
          </p>
        </>
      ) : form === 'none' ? (
        <>
          <p style={{ marginTop: 0, opacity: 0.8 }}>
            An account keeps your streak and today’s result in step across your
            phone and your computer, and puts your name on the leaderboard.
            Already have a streak going? It comes with you — sign in on each
            device and the longest one carries on.
          </p>
          <p style={{ opacity: 0.8 }}>
            Just a username and a password. <strong>No email</strong> — which
            also means a forgotten password can’t be reset.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setForm('register')}
              style={primary}
            >
              Create account
            </button>
            <button
              type="button"
              onClick={() => setForm('login')}
              style={secondary}
            >
              Sign in
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <h3 style={{ margin: '8px 0' }}>
            {form === 'register' ? 'Create your account' : 'Sign in'}
          </h3>
          <label style={field}>
            <span>Username</span>
            <input
              type="text"
              value={username}
              maxLength={40}
              placeholder={form === 'register' ? 'e.g. spicy_al' : ''}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setUsername(e.target.value)}
              style={input}
            />
            {form === 'register' && (
              <span style={hint}>
                <strong>Not an email.</strong> Make up any username: 3 to 20
                letters, numbers or _. We never ask for an email address, and
                the username is only for signing in.
              </span>
            )}
          </label>
          {form === 'register' && (
            <label style={field}>
              <span>Display name (optional)</span>
              <input
                type="text"
                value={name}
                maxLength={20}
                autoComplete="nickname"
                onChange={(e) => setName(e.target.value)}
                style={input}
              />
              <span style={hint}>
                Shown on the leaderboard. Leave it blank to use your username;
                you can change it any time.
              </span>
            </label>
          )}
          <label style={field}>
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete={
                form === 'register' ? 'new-password' : 'current-password'
              }
              onChange={(e) => setPassword(e.target.value)}
              style={input}
            />
            {form === 'register' && (
              <span style={hint}>
                At least 8 characters. There is no reset, so keep it somewhere
                safe.
              </span>
            )}
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" disabled={busy} style={primary}>
              {busy
                ? 'Working…'
                : form === 'register'
                  ? 'Create account'
                  : 'Sign in'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setForm('none')
                setError('')
              }}
              style={secondary}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" style={{ color: '#ff8a7a', fontWeight: 600 }}>
          {error}
        </p>
      )}
      {note && !error && (
        <p role="status" style={{ color: '#2ecc71', fontWeight: 600 }}>
          {note}
        </p>
      )}
    </main>
  )
}

const linkButton: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#7fb2ff',
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
}

const field: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 12,
  fontWeight: 600,
}

const hint: CSSProperties = {
  fontSize: 13,
  fontWeight: 400,
  opacity: 0.7,
  lineHeight: 1.4,
}

const input: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  background: '#0b1118',
  color: 'var(--fg)',
  border: '1px solid #2a3543',
  // 16px: iOS Safari zooms the page on focus for anything smaller.
  fontSize: 16,
}

const primary: CSSProperties = {
  padding: '8px 14px',
  fontSize: 15,
  fontWeight: 600,
  borderRadius: 8,
  border: 'none',
  background: '#f4b400',
  color: '#0f1720',
  cursor: 'pointer',
}

const secondary: CSSProperties = {
  ...primary,
  border: '1px solid #7fb2ff',
  background: 'transparent',
  color: '#7fb2ff',
}
