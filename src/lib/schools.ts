/** Round-clue phrasing for a town's school(s). Pure; unit-tested. */

/** "Home of the University of Michigan" / "Home of Carleton College and St. Olaf College". */
export function schoolsLine(schools: string[]): string {
  if (schools.length === 0) return ''
  if (schools.length === 1) return `Home of ${schools[0]}`
  const last = schools[schools.length - 1]
  return `Home of ${schools.slice(0, -1).join(', ')} and ${last}`
}
