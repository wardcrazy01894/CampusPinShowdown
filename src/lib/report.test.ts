import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  addTownRequestMessage,
  bugReportUrl,
  buildReportPayload,
  submitBugReport,
  REPO_URL,
} from './report'

describe('bugReportUrl', () => {
  it('points at the repo new-issue page', () => {
    expect(bugReportUrl()).toContain(`${REPO_URL}/issues/new`)
  })

  it('includes a title and body query params with the puzzle date', () => {
    const u = new URL(bugReportUrl({ date: '2026-10-29' }))
    expect(u.searchParams.get('title')).toContain('bug')
    expect(u.searchParams.get('body') || '').toContain('2026-10-29')
  })

  it('is encoded (no spaces in the raw query string)', () => {
    expect(bugReportUrl({}, 'map is blank')).not.toMatch(/ /)
  })

  it('includes the typed message in the body and its first line in the title', () => {
    const u = new URL(bugReportUrl({}, 'map is blank\nsecond line'))
    expect(u.searchParams.get('body')).toContain('map is blank')
    expect(u.searchParams.get('title')).toBe('[bug] map is blank')
  })
})

describe('addTownRequestMessage', () => {
  it('names the town when given', () => {
    expect(addTownRequestMessage('Tuscaloosa')).toBe(
      'Please add "Tuscaloosa" to the game.',
    )
  })

  it('trims and strips embedded double-quotes so the wrapping quotes never nest', () => {
    expect(addTownRequestMessage('  "Oxford", MS ')).toBe(
      'Please add "Oxford, MS" to the game.',
    )
  })

  it('falls back to a generic request when no name is given', () => {
    const m = addTownRequestMessage('   ')
    expect(m.toLowerCase()).toContain('add')
    expect(m).not.toContain('""')
  })
})

describe('buildReportPayload', () => {
  it('carries the trimmed message, puzzle date, and logs unless opted out', () => {
    const p = buildReportPayload('  map blank  ', { date: '2026-10-29' })
    expect(p.message).toBe('map blank')
    expect(p.context.date).toBe('2026-10-29')
    expect(typeof p.logs).toBe('string')
    expect(buildReportPayload('x', {}, { includeLogs: false }).logs).toBe('')
  })
})

describe('submitBugReport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('falls back to the prefilled issue URL when no endpoint is configured', async () => {
    vi.stubEnv('VITE_BUG_ENDPOINT', '')
    const r = await submitBugReport('hi', { date: '2026-10-29' })
    expect(r.ok).toBe(false)
    expect(r.fallbackUrl).toContain(`${REPO_URL}/issues/new`)
  })

  it('POSTs to the endpoint and returns the created issue url', async () => {
    vi.stubEnv('VITE_BUG_ENDPOINT', 'https://bug.example/')
    let sent: { url: string; body: string } | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        sent = { url, body: String(init.body) }
        return {
          ok: true,
          json: async () => ({
            ok: true,
            url: 'https://github.com/o/r/issues/1',
          }),
        }
      }),
    )
    const r = await submitBugReport('map blank', { date: '2026-10-29' })
    expect(r).toEqual({ ok: true, url: 'https://github.com/o/r/issues/1' })
    expect(sent!.url).toBe('https://bug.example/')
    expect(JSON.parse(sent!.body).context.date).toBe('2026-10-29')
  })

  it('throws with the status and server reason on a rejected send', async () => {
    vi.stubEnv('VITE_BUG_ENDPOINT', 'https://bug.example/')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 429,
        text: async () => '{"error":"rate limited, try later"}',
      })),
    )
    await expect(submitBugReport('hi')).rejects.toThrow(/429.*rate limited/)
  })
})
