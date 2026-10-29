/**
 * Pure helpers for scripts/build-towns.mjs (unit-tested in build-towns-lib.test.mjs).
 * Turns the hand-curated data/towns-seed.json into public/towns.json rows.
 */

export const STATE_NAMES = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
}

const DIFFICULTIES = new Set(['easy', 'medium', 'hard'])

/** Lower-48 play box, mirrored from src/lib/region.ts (kept in sync by a test there). */
export const CONUS = { south: 24.4, west: -125.2, north: 49.5, east: -66.6 }

/** "St. Peter" + "MN" → "st-peter-mn". ASCII-folds, drops punctuation. */
export function slug(name, stateCode) {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base}-${stateCode.toLowerCase()}`
}

/**
 * Validate the seed list. Returns a list of human-readable problems (empty =
 * valid). Checks shape, known state codes, difficulty values, and uniqueness
 * of (name, state) / derived ids.
 */
export function validateSeed(seed) {
  const problems = []
  if (!Array.isArray(seed)) return ['seed is not an array']
  const ids = new Set()
  seed.forEach((e, i) => {
    const where = `entry ${i} (${e?.name ?? '?'}, ${e?.stateCode ?? '?'})`
    if (!e || typeof e.name !== 'string' || !e.name.trim())
      problems.push(`${where}: missing name`)
    if (!STATE_NAMES[e?.stateCode])
      problems.push(`${where}: unknown stateCode "${e?.stateCode}"`)
    if (!Array.isArray(e?.schools) || e.schools.length === 0)
      problems.push(`${where}: schools must be a non-empty array`)
    else if (e.schools.some((s) => typeof s !== 'string' || !s.trim()))
      problems.push(`${where}: every school must be a non-empty string`)
    if (!DIFFICULTIES.has(e?.difficulty))
      problems.push(`${where}: difficulty must be easy|medium|hard`)
    if ((e?.lat == null) !== (e?.lng == null))
      problems.push(`${where}: lat and lng must be given together`)
    if (e?.name && e?.stateCode) {
      const id = slug(e.name, e.stateCode)
      if (ids.has(id)) problems.push(`${where}: duplicate id "${id}"`)
      ids.add(id)
    }
  })
  return problems
}

/** The Nominatim free-text query for a seed entry. */
export function nominatimQuery(entry) {
  return `${entry.name}, ${STATE_NAMES[entry.stateCode]}, USA`
}

const PLACE_TYPES = new Set([
  'city',
  'town',
  'village',
  'hamlet',
  'borough',
  'suburb',
  'neighbourhood',
  'census-designated-place',
  'locality',
  'administrative',
])

/**
 * Choose the best Nominatim hit for an entry: must be in the right state
 * (address.state) and be a settlement-ish place (not a university building or
 * a county), preferring `place` results over `boundary` ones. Returns null if
 * nothing qualifies — the caller treats that as a miss to fix by hand.
 */
export function pickResult(results, entry) {
  const wantState = STATE_NAMES[entry.stateCode]
  const ok = (results ?? []).filter(
    (r) =>
      r?.address?.state === wantState &&
      (r.category === 'place' || r.category === 'boundary') &&
      PLACE_TYPES.has(r.type) &&
      Number.isFinite(Number(r.lat)) &&
      Number.isFinite(Number(r.lon)),
  )
  ok.sort((a, b) => {
    const pa = a.category === 'place' ? 0 : 1
    const pb = b.category === 'place' ? 0 : 1
    return pa - pb || (b.importance ?? 0) - (a.importance ?? 0)
  })
  return ok[0] ?? null
}

/** True when a point lies inside the lower-48 play box. */
export function inConus({ lat, lng }) {
  return (
    lat >= CONUS.south &&
    lat <= CONUS.north &&
    lng >= CONUS.west &&
    lng <= CONUS.east
  )
}

const round4 = (n) => Math.round(n * 1e4) / 1e4

/**
 * Build one public/towns.json row from a seed entry plus its coordinates.
 * `coords` is `{ lat, lng, source }` where source is 'manual' (seed override)
 * or 'nominatim'. Coordinates are rounded to 4 dp (~11 m) — plenty for a game
 * scored at 25 km, and it keeps the file diff-friendly.
 */
export function toTown(entry, coords) {
  return {
    id: slug(entry.name, entry.stateCode),
    name: entry.name,
    state: STATE_NAMES[entry.stateCode],
    stateCode: entry.stateCode,
    schools: entry.schools.map((s) => s.trim()),
    lat: round4(coords.lat),
    lng: round4(coords.lng),
    difficulty: entry.difficulty,
    source: coords.source,
    attribution:
      coords.source === 'nominatim'
        ? '© OpenStreetMap contributors (ODbL), via Nominatim'
        : 'hand-pinned',
  }
}

/** Stable output ordering (by id) so rebuilds produce minimal diffs. */
export function sortTowns(towns) {
  return [...towns].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
