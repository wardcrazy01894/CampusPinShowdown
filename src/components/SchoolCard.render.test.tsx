// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import { SchoolCard } from './SchoolCard'
import { resetSchoolFactsCache } from '../lib/schoolFacts'
import type { SchoolsFile } from '../types'

const file: SchoolsFile = {
  version: 1,
  generated: '2026-11-08',
  attribution: 'Wikipedia',
  rankingEdition: 2026,
  schools: [
    {
      school: 'Texas Tech University',
      wikipedia: 'Texas Tech University',
      funFact: 'The Masked Rider leads the team out.',
      type: 'Public',
      founded: 1923,
      undergrad: 34184,
      postgrad: 8271,
      enrollmentAsOf: 'fall 2025',
      mascot: 'Masked Rider, Raider Red',
      nickname: 'Red Raiders',
      division: 'NCAA Division I FBS',
      conference: 'Big 12',
      ranking: { list: 'National Universities', rank: 186 },
      alumni: ['Gene Kelly (dancer)', 'Paul Berg (biochemist)'],
    },
    {
      school: 'Tiny College',
      wikipedia: 'Tiny College',
      funFact: 'It is tiny.',
    },
  ],
}

beforeEach(() => resetSchoolFactsCache())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SchoolCard', () => {
  it('shows the fun fact, the stat lines, alumni and a Wikipedia credit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => file })),
    )
    render(<SchoolCard school="Texas Tech University" />)
    await waitFor(() =>
      expect(
        screen.getByText(/The Masked Rider leads the team out/),
      ).toBeTruthy(),
    )
    const card = screen.getByRole('complementary', {
      name: 'About Texas Tech University',
    })
    expect(card.textContent).toContain('Public · founded 1923')
    expect(card.textContent).toContain(
      '34,184 undergrad · 8,271 grad (fall 2025)',
    )
    expect(card.textContent).toContain('Red Raiders · Big 12 · D-I FBS')
    expect(card.textContent).toContain('Mascot: Masked Rider, Raider Red')
    expect(card.textContent).toContain(
      '#186 National Universities (U.S. News 2026)',
    )
    expect(card.textContent).toContain(
      'Gene Kelly (dancer) · Paul Berg (biochemist)',
    )
    const link = screen.getByRole('link', {
      name: /Wikipedia/,
    }) as HTMLAnchorElement
    expect(link.href).toBe(
      'https://en.wikipedia.org/wiki/Texas_Tech_University',
    )
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
  })

  it('renders only what the row has — a fun fact alone is fine', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => file })),
    )
    render(<SchoolCard school="Tiny College" />)
    await waitFor(() => expect(screen.getByText(/It is tiny/)).toBeTruthy())
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByText(/alumni/i)).toBeNull()
  })

  it('renders nothing for an unknown school or when the file cannot load', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => file }))
    vi.stubGlobal('fetch', f)
    const { container, unmount } = render(<SchoolCard school="Nowhere U" />)
    await waitFor(() => expect(f).toHaveBeenCalled())
    await Promise.resolve()
    expect(container.textContent).toBe('')
    unmount()
    resetSchoolFactsCache()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    )
    const { container: c2 } = render(
      <SchoolCard school="Texas Tech University" />,
    )
    await waitFor(() => expect(c2.textContent).toBe(''))
  })
})
