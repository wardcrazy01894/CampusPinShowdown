import { describe, it, expect } from 'vitest'
import { schoolsLine, promptSchool } from './schools'

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

describe('promptSchool', () => {
  it('asks about the first listed school and never the town', () => {
    expect(
      promptSchool({ name: 'Lubbock', schools: ['Texas Tech University'] }),
    ).toBe('Texas Tech University')
    expect(
      promptSchool({
        name: 'Cambridge',
        schools: [
          'Harvard University',
          'Massachusetts Institute of Technology',
        ],
      }),
    ).toBe('Harvard University')
    expect(promptSchool({ name: 'X', schools: [] })).toBe('')
  })

  it('prefers a school whose name does not give the town away', () => {
    expect(
      promptSchool({
        name: 'Moorhead',
        schools: ['Minnesota State University Moorhead', 'Concordia College'],
      }),
    ).toBe('Concordia College')
    expect(
      promptSchool({
        name: 'Oneonta',
        schools: ['SUNY Oneonta', 'Hartwick College'],
      }),
    ).toBe('Hartwick College')
    // No alternative → the (town-bearing) first school is accepted.
    expect(
      promptSchool({
        name: 'Austin',
        schools: ['University of Texas at Austin'],
      }),
    ).toBe('University of Texas at Austin')
    expect(
      promptSchool({
        name: 'St. Peter',
        schools: ['Gustavus Adolphus College'],
      }),
    ).toBe('Gustavus Adolphus College')
  })
})
