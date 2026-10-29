/**
 * Round-prompt phrasing. The PROMPT names the school ("Where is Texas Tech
 * University?"); the TOWN is the answer and appears only after the guess
 * ("Lubbock, Texas — home of Texas Tech University"). Pure; unit-tested.
 */

/** The school the round asks about: the first listed (Cambridge → Harvard). */
export function promptSchool(schools: string[]): string {
  return schools[0] ?? ''
}

/** "Home of the University of Michigan" / "Home of Carleton College and St. Olaf College". */
export function schoolsLine(schools: string[]): string {
  if (schools.length === 0) return ''
  if (schools.length === 1) return `Home of ${schools[0]}`
  const last = schools[schools.length - 1]
  return `Home of ${schools.slice(0, -1).join(', ')} and ${last}`
}
