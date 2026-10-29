// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { App } from './App'

afterEach(cleanup)

describe('App (scaffold)', () => {
  it('renders the game title', () => {
    const { getByRole } = render(<App />)
    expect(getByRole('heading', { level: 1 }).textContent).toContain(
      'CampusPin Showdown',
    )
  })
})
