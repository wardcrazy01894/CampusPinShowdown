import { describe, it, expect } from 'vitest'
import { addTownRequestMessage, bugReportUrl, REPO_URL } from './report'

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
