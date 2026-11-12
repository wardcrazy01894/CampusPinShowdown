// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { SchoolSearch } from './SchoolSearch'
import type { Town } from '../types'

const town = (
  name: string,
  stateCode: string,
  state: string,
  schools: string[],
): Town => ({
  id: `${name}-${stateCode}`.toLowerCase().replace(/\s+/g, '-'),
  name,
  state,
  stateCode,
  schools,
  lat: 42.28,
  lng: -83.74,
  difficulty: 'easy',
  source: 'manual',
  attribution: 't',
})

const towns: Town[] = [
  town('Ann Arbor', 'MI', 'Michigan', ['University of Michigan']),
  town('West Lafayette', 'IN', 'Indiana', ['Purdue University']),
]

afterEach(cleanup)

const search = (value: string) =>
  fireEvent.change(screen.getByLabelText('Search schools'), {
    target: { value },
  })

describe('SchoolSearch', () => {
  it('says a school is in the game — without ever showing its town or state', () => {
    const { container } = render(
      <SchoolSearch towns={towns} onClose={() => {}} />,
    )
    expect(screen.getByText(/2 schools so far/)).toBeTruthy()
    search('purdue')
    expect(screen.getByText(/In the game/)).toBeTruthy()
    expect(screen.getByText('Purdue University')).toBeTruthy()
    // The town is the answer to a round: it must not be anywhere on screen.
    const text = container.textContent ?? ''
    for (const spoiler of ['Lafayette', 'Indiana', ', IN', 'Ann Arbor'])
      expect(text).not.toContain(spoiler)
  })

  it('does not find a school by typing its town', () => {
    render(<SchoolSearch towns={towns} onClose={() => {}} />)
    search('Ann Arbor')
    expect(screen.queryByText(/In the game/)).toBeNull()
    expect(screen.getByText(/Not in the game \(yet\)/)).toBeTruthy()
    // …and says why, so a town typed by habit isn't taken for a missing one.
    expect(screen.getByText(/school’s name, not its town/)).toBeTruthy()
  })

  it('offers a request link for a missing school', () => {
    render(<SchoolSearch towns={towns} onClose={() => {}} />)
    search('Alcorn State')
    expect(screen.getByText(/Not in the game \(yet\)/)).toBeTruthy()
    const link = screen.getByRole('link', {
      name: /Request to add it/,
    }) as HTMLAnchorElement
    expect(link.href).toContain(
      'github.com/wardcrazy01894/CampusPinShowdown/issues/new',
    )
    expect(decodeURIComponent(link.href)).toContain('Please add "Alcorn State"')
    expect(link.target).toBe('_blank')
  })

  it('says nothing until two characters are typed', () => {
    render(<SchoolSearch towns={towns} onClose={() => {}} />)
    search('p')
    expect(screen.queryByText(/In the game/)).toBeNull()
    expect(screen.queryByText(/Not in the game/)).toBeNull()
  })

  it('caps a long list and says to keep typing', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      town(`Town ${i}`, 'MI', 'Michigan', [`Test College ${i}`]),
    )
    render(<SchoolSearch towns={many} onClose={() => {}} />)
    search('test college')
    expect(screen.getAllByRole('listitem')).toHaveLength(12)
    expect(screen.getByText(/18 more/)).toBeTruthy()
  })
})

describe('SchoolSearch — in-app request', () => {
  it('opens the report form prefilled instead of a GitHub link when onRequest is given', () => {
    const onRequest = vi.fn()
    render(
      <SchoolSearch towns={towns} onClose={() => {}} onRequest={onRequest} />,
    )
    search('Alcorn State')
    fireEvent.click(screen.getByRole('button', { name: /Request to add it/ }))
    expect(onRequest).toHaveBeenCalledWith(
      'Please add "Alcorn State" to the game.',
    )
    expect(screen.queryByRole('link', { name: /Request to add it/ })).toBeNull()
  })

  it('closes on back and on Escape', () => {
    const onClose = vi.fn()
    render(<SchoolSearch towns={towns} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /back/ }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
