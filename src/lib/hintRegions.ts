/**
 * Hint regions — what "💡 Reveal the region" shows. The exact state would be
 * too strong a hint (owner, 2026-10-29), so the lower 48 + DC are grouped
 * into eleven contiguous regions of 3–6 states; the hint names the region and
 * lists its states. Pure data + lookup; hintRegions.test.ts proves every
 * state in the dataset maps to exactly one region.
 */

export interface HintRegion {
  name: string
  states: readonly string[]
}

export const HINT_REGIONS: readonly HintRegion[] = [
  { name: 'New England', states: ['CT', 'MA', 'ME', 'NH', 'RI', 'VT'] },
  { name: 'the Mid-Atlantic', states: ['NY', 'NJ', 'PA', 'DE', 'MD', 'DC'] },
  { name: 'the Southeast', states: ['VA', 'NC', 'SC', 'GA', 'FL'] },
  { name: 'Appalachia', states: ['WV', 'KY', 'TN'] },
  { name: 'the Gulf South', states: ['AL', 'MS', 'LA', 'AR'] },
  { name: 'the Great Lakes', states: ['OH', 'MI', 'IN', 'IL', 'WI'] },
  { name: 'the Upper Midwest', states: ['MN', 'IA', 'ND', 'SD', 'NE'] },
  { name: 'the Central Plains', states: ['MO', 'KS', 'OK'] },
  { name: 'the Southwest', states: ['TX', 'NM', 'AZ'] },
  { name: 'the Mountain West', states: ['CO', 'UT', 'WY', 'MT', 'ID', 'NV'] },
  { name: 'the Pacific Coast', states: ['CA', 'OR', 'WA'] },
]

/** The region a state belongs to. Throws on an unknown code so a dataset
 *  addition outside the map is caught by the guard test, not by a player. */
export function hintRegion(stateCode: string): HintRegion {
  const r = HINT_REGIONS.find((x) => x.states.includes(stateCode))
  if (!r) throw new Error(`no hint region for state ${stateCode}`)
  return r
}

/** "the Great Lakes (OH, MI, IN, IL, WI)" — the text shown as the hint. */
export function hintText(stateCode: string): string {
  const r = hintRegion(stateCode)
  return `${r.name} (${r.states.join(', ')})`
}
