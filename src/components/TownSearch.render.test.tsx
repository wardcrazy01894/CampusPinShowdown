// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { TownSearch } from './TownSearch'
import type { Town } from '../types'

const towns: Town[] = [
  {
    id: 'ann-arbor-mi',
    name: 'Ann Arbor',
    state: 'Michigan',
    stateCode: 'MI',
    schools: ['University of Michigan'],
    lat: 42.28,
    lng: -83.74,
    difficulty: 'easy',
    source: 'manual',
    attribution: 't',
  },
]

afterEach(cleanup)

describe('TownSearch', () => {
  it('confirms an included town and offers a request link for a missing one', () => {
    render(<TownSearch towns={towns} onClose={() => {}} />)
    const input = screen.getByLabelText('Search towns')
    fireEvent.change(input, { target: { value: 'ann arbor' } })
    expect(screen.getByText(/Yes — that’s in the game!/)).toBeTruthy()

    fireEvent.change(input, { target: { value: 'Tuscaloosa' } })
    expect(screen.getByText(/Not in the game \(yet\)/)).toBeTruthy()
    const link = screen.getByRole('link', {
      name: /Request to add it/,
    }) as HTMLAnchorElement
    expect(link.href).toContain(
      'github.com/wardcrazy01894/CampusPinShowdown/issues/new',
    )
    expect(decodeURIComponent(link.href)).toContain('Please add "Tuscaloosa"')
    expect(link.target).toBe('_blank')
  })

  it('finds by school and fills the input on pick', () => {
    render(<TownSearch towns={towns} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Search towns'), {
      target: { value: 'michigan' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Ann Arbor, MI/ }))
    expect(
      (screen.getByLabelText('Search towns') as HTMLInputElement).value,
    ).toBe('Ann Arbor, MI')
  })
})
