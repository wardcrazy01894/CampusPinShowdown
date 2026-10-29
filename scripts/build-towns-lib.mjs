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

/**
 * Settlement kinds we accept, best first. Nominatim's `addresstype` (jsonv2)
 * says what KIND of place a hit is regardless of whether it came back as a
 * `place` node or a `boundary/administrative` polygon — which is the field
 * that matters. Counties, states and districts are NOT here, so a county
 * boundary that shares the town's name (Hamilton County for Hamilton, NY) can
 * never win; and a city/town/village always beats a same-named neighbourhood
 * or hamlet (Claremont, CA the city vs. the Claremont neighbourhood of
 * Berkeley; Clinton, NY the village vs. Clinton in Manhattan).
 */
export const SETTLEMENT_RANK = [
  'city',
  'town',
  'village',
  'borough',
  'municipality',
  'hamlet',
  'census-designated-place',
  'locality',
  'suburb',
  'quarter',
  'neighbourhood',
]

/**
 * Choose the best Nominatim hit for an entry: must be in the right state
 * (address.state) and be a settlement (SETTLEMENT_RANK by `addresstype`),
 * ranked by settlement kind first and Nominatim `importance` second. Returns
 * null if nothing qualifies — the caller treats that as a miss to fix by hand.
 */
export function pickResult(results, entry) {
  const wantState = STATE_NAMES[entry.stateCode]
  const rank = (r) => SETTLEMENT_RANK.indexOf(r?.addresstype)
  const ok = (results ?? []).filter(
    (r) =>
      r?.address?.state === wantState &&
      rank(r) !== -1 &&
      Number.isFinite(Number(r.lat)) &&
      Number.isFinite(Number(r.lon)),
  )
  ok.sort(
    (a, b) => rank(a) - rank(b) || (b.importance ?? 0) - (a.importance ?? 0),
  )
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

/** Great-circle distance in km (duplicated from src/lib/scoring.ts so the Node script has no TS import). */
export function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(s))
}

/**
 * How far a geocoded pin may sit from the town's INDEPENDENT Census pin
 * (data/census-pins.json, the place polygon's internal point) before the build
 * and the dataset guard test fail: 10 km, or 1.5× the place's equivalent
 * radius (√(land area/π)) when that is larger. The floor catches every class
 * of geocoder mistake seen so far (same-named county ≥16 km for small towns,
 * neighbourhood/hamlet hundreds of km); the size term tolerates a downtown
 * node sitting 12–17 km from a sprawling city's internal point (Tucson,
 * Columbia SC, Colorado Springs) without loosening the check for a village.
 * Mirrored in src/lib/towns.test.ts.
 */
export const CENSUS_TOLERANCE_KM = 10
export const CENSUS_RADIUS_FACTOR = 1.5

export function censusToleranceKm(pin) {
  const r = Math.sqrt((pin?.alandKm2 ?? 0) / Math.PI)
  return Math.max(CENSUS_TOLERANCE_KM, CENSUS_RADIUS_FACTOR * r)
}

/**
 * Towns whose pin disagrees with their Census pin by more than `toleranceKm`,
 * plus towns with NO Census pin at all (every town must have one — see
 * scripts/build-census-pins.mjs). Pure; returns [] when all is well.
 */
export function censusMismatches(towns, pins) {
  const out = []
  for (const t of towns) {
    const c = pins[t.id]
    if (!c) {
      out.push({ id: t.id, km: null, reason: 'no Census pin' })
      continue
    }
    const km = haversineKm(t, c)
    const tol = censusToleranceKm(c)
    if (km > tol)
      out.push({
        id: t.id,
        km: Math.round(km),
        reason: `${Math.round(km)} km from Census pin (${c.place}; tolerance ${Math.round(tol)} km)`,
      })
  }
  return out
}
