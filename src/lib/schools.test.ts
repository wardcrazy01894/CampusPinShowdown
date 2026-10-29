import { describe, it, expect } from 'vitest'
import { schoolsLine } from './schools'

describe('schoolsLine', () => {
  it('phrases one, two, and three schools', () => {
    expect(schoolsLine(['University of Michigan'])).toBe(
      'Home of University of Michigan',
    )
    expect(schoolsLine(['Carleton College', 'St. Olaf College'])).toBe(
      'Home of Carleton College and St. Olaf College',
    )
    expect(schoolsLine(['A', 'B', 'C'])).toBe('Home of A, B and C')
    expect(schoolsLine([])).toBe('')
  })
})
