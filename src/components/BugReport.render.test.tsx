// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react'

/**
 * DOM-level tests for the in-app bug form: sends through the report lib and
 * stays on the site (thanks screen + issue link); shows an error on a failed
 * send; prefills a town request; Escape closes. The report lib is mocked so
 * ok/!ok/throw can be driven. Turnstile is off here (no sitekey).
 */

const { submitBugReport } = vi.hoisted(() => ({ submitBugReport: vi.fn() }))
vi.mock('../lib/report', async (importActual) => ({
  ...(await importActual<typeof import('../lib/report')>()),
  submitBugReport,
}))

import { BugReport } from './BugReport'

beforeEach(() => {
  vi.stubEnv('VITE_TURNSTILE_SITEKEY', '')
  submitBugReport.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

function fillAndSend(text = 'the map went black') {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: /send report/i }))
}

describe('BugReport', () => {
  it('sends the typed message with the puzzle context and shows the thanks screen in place', async () => {
    submitBugReport.mockResolvedValue({
      ok: true,
      url: 'https://github.com/owner/repo/issues/7',
    })
    render(<BugReport onClose={() => {}} context={{ date: '2026-10-29' }} />)
    expect(
      (
        screen.getByRole('button', {
          name: /send report/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true) // empty message
    fillAndSend()
    expect(await screen.findByText(/your report was sent/i)).toBeTruthy()
    expect(submitBugReport).toHaveBeenCalledWith(
      'the map went black',
      { date: '2026-10-29' },
      expect.objectContaining({ includeLogs: true }),
    )
    const a = screen.getByRole('link', { name: /view the issue/i })
    expect(a.getAttribute('href')).toBe(
      'https://github.com/owner/repo/issues/7',
    )
  })

  it('never renders a non-github result url as a link', async () => {
    submitBugReport.mockResolvedValue({
      ok: true,
      url: 'https://evil.example/',
    })
    render(<BugReport onClose={() => {}} context={{}} />)
    fillAndSend()
    await screen.findByText(/your report was sent/i)
    expect(screen.queryByRole('link', { name: /view the issue/i })).toBeNull()
  })

  it('shows an error and keeps the text when the send fails', async () => {
    submitBugReport.mockRejectedValue(new Error('HTTP 429'))
    render(<BugReport onClose={() => {}} context={{}} />)
    fillAndSend()
    expect(await screen.findByText(/couldn’t send/i)).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'the map went black',
    )
  })

  it('respects the diagnostics checkbox', async () => {
    submitBugReport.mockResolvedValue({ ok: true })
    render(<BugReport onClose={() => {}} context={{}} />)
    fireEvent.click(screen.getByRole('checkbox'))
    fillAndSend()
    await waitFor(() =>
      expect(submitBugReport).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.objectContaining({ includeLogs: false }),
      ),
    )
  })

  it('prefills a town request and closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <BugReport
        onClose={onClose}
        context={{}}
        initialMessage='Please add "Lorman, MS" to the game.'
      />,
    )
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Please add "Lorman, MS" to the game.',
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
