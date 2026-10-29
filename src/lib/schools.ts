/**
 * Round-prompt phrasing. The PROMPT names the school ("Where is Texas Tech
 * University?"); the TOWN is the answer and appears only after the guess
 * ("Lubbock, Texas — home of Texas Tech University"). Pure; unit-tested.
 */

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * The school the round asks about. An explicit `prompt` override wins (set in
 * the seed when the rule below would pick a school far below the town's tier:
 * Memphis asks "University of Memphis", not Rhodes College). Otherwise prefers
 * a school whose name does NOT contain the town's name (Moorhead → Concordia
 * College, not "Minnesota State University Moorhead"); otherwise the first
 * listed (Cambridge → Harvard). Flagship names that embed the town
 * ("University of Texas at Austin") have no alternative and are accepted —
 * the town's name is not the answer, its location is.
 */
export function promptSchool(town: {
  name: string
  schools: string[]
  prompt?: string
}): string {
  if (town.prompt) return town.prompt
  const t = fold(town.name)
  return town.schools.find((s) => !fold(s).includes(t)) ?? town.schools[0] ?? ''
}

/** "Home of the University of Michigan" / "Home of Carleton College and St. Olaf College". */
export function schoolsLine(schools: string[]): string {
  if (schools.length === 0) return ''
  if (schools.length === 1) return `Home of ${schools[0]}`
  const last = schools[schools.length - 1]
  return `Home of ${schools.slice(0, -1).join(', ')} and ${last}`
}
