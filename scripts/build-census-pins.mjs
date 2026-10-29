#!/usr/bin/env node
/**
 * Build data/census-pins.json — an INDEPENDENT, public-domain pin for every
 * seeded town, from the US Census Bureau's national Places Gazetteer. Used to
 * cross-check the Nominatim-geocoded pins in public/towns.json (build-towns
 * fails, and the dataset guard test fails, if any town is more than
 * CENSUS_TOLERANCE_KM from its Census pin). This is what catches a geocoder
 * picking a same-named county, neighbourhood or hamlet.
 *
 *   node scripts/build-census-pins.mjs <path/to/2024_Gaz_place_national.txt>
 *
 * Get the file from https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html
 * ("Places" → national). It is tab-separated with columns USPS, GEOID, ANSICODE,
 * NAME, LSAD, FUNCSTAT, ALAND, AWATER, ALAND_SQMI, AWATER_SQMI, INTPTLAT,
 * INTPTLONG. NAME carries a legal/statistical suffix ("Ann Arbor city",
 * "Gambier village", "Stanford CDP") and consolidated governments appear as
 * "Athens-Clarke County unified government (balance)" — both handled below.
 *
 * Matching is by state + name; when several places share a name in a state
 * (rare) the incorporated one wins (city > town > village > borough > CDP),
 * then the larger land area. Unmatched towns are listed and the script exits
 * 1 — add them to MANUAL_CENSUS below (with a source comment) or fix the seed.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { slug, validateSeed } from './build-towns-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SEED = path.join(ROOT, 'data', 'towns-seed.json')
const OUT = path.join(ROOT, 'data', 'census-pins.json')

/** Towns the Gazetteer has no place row for; pins from the named source. */
const MANUAL_CENSUS = {
  // USMA is a CDP named "West Point" — present in the Gazetteer; kept here only
  // as the documented example of the mechanism.
}

/** LSAD → preference (lower wins). 25 city, 43 town, 47 village, 21 borough, 57 CDP. */
const LSAD_PREF = { 25: 0, 43: 1, 47: 2, 21: 3, 53: 4, 57: 5 }

const norm = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** "Ann Arbor city" → "ann arbor"; "Athens-Clarke County unified government (balance)" → "athens clarke county unified government balance". */
function baseName(name) {
  return norm(
    name.replace(
      /\s+(city|town|village|borough|CDP|municipality|township|town and county|urban county|consolidated government|unified government|metropolitan government|corporation|plantation|comunidad|zona urbana)(\s*\(balance\))?$/i,
      '',
    ),
  )
}

export function matchPlace(rows, entry) {
  const want = norm(entry.name)
  const inState = rows.filter((r) => r.USPS === entry.stateCode)
  const byPref = (a, b) =>
    (LSAD_PREF[a.LSAD] ?? 9) - (LSAD_PREF[b.LSAD] ?? 9) ||
    Number(b.ALAND) - Number(a.ALAND)
  // 1. Exact name. Also accepts Massachusetts' "Amherst Town city" and Idaho's
  //    "Boise City city" forms (the legal name carries an extra Town/City).
  const exact = inState.filter((r) => {
    const b = baseName(r.NAME)
    return b === want || b === `${want} town` || b === `${want} city`
  })
  if (exact.length) return exact.sort(byPref)[0]
  // 2. A consolidated city–county ("Athens-Clarke County unified government",
  //    "Lexington-Fayette urban county", "Macon-Bibb County") or a campus CDP
  //    that carries the town's name ("Haverford College CDP"). Only when no
  //    exact row exists, so "Clinton" can never drift to "Clinton Corners".
  const loose = inState.filter((r) => baseName(r.NAME).startsWith(want + ' '))
  return loose.sort(byPref)[0] ?? null
}

async function main() {
  const gazPath = process.argv[2]
  if (!gazPath) {
    console.error(
      'usage: node scripts/build-census-pins.mjs <Gaz_place_national.txt>',
    )
    process.exit(2)
  }
  const seed = JSON.parse(await readFile(SEED, 'utf8'))
  const problems = validateSeed(seed)
  if (problems.length) {
    console.error('Seed is invalid:\n  ' + problems.join('\n  '))
    process.exit(1)
  }
  const text = await readFile(gazPath, 'utf8')
  const [header, ...lines] = text.split(/\r?\n/).filter(Boolean)
  const cols = header.split('\t').map((c) => c.trim())
  const rows = lines.map((l) => {
    const v = l.split('\t').map((c) => c.trim())
    return Object.fromEntries(cols.map((c, i) => [c, v[i]]))
  })

  const pins = {}
  const misses = []
  for (const entry of seed) {
    const id = slug(entry.name, entry.stateCode)
    if (MANUAL_CENSUS[id]) {
      pins[id] = MANUAL_CENSUS[id]
      continue
    }
    const row = matchPlace(rows, entry)
    if (!row) {
      misses.push(`${id} ("${entry.name}", ${entry.stateCode})`)
      continue
    }
    // Non-exact matches (consolidated city-counties, "X Town city", campus
    // CDPs) are printed so a human eyeballs every one of them.
    if (baseName(row.NAME) !== norm(entry.name)) {
      console.log(`  non-exact match: ${id} → "${row.NAME}"`)
    }
    pins[id] = {
      lat: Number(row.INTPTLAT),
      lng: Number(row.INTPTLONG),
      place: row.NAME,
      geoid: row.GEOID,
      // Land area (km²): lets the cross-check tolerate a downtown node sitting
      // far from a sprawling city's internal point (Tucson, Columbia SC).
      alandKm2: Math.round(Number(row.ALAND) / 1e6),
    }
  }
  const sorted = Object.fromEntries(
    Object.keys(pins)
      .sort()
      .map((k) => [k, pins[k]]),
  )
  await writeFile(
    OUT,
    JSON.stringify(
      {
        source:
          'US Census Bureau, 2024 Gazetteer Files — Places (national). Public domain. INTPTLAT/INTPTLONG = internal point of the place polygon; alandKm2 = ALAND.',
        pins: sorted,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(
    `Wrote ${Object.keys(pins).length} Census pins → data/census-pins.json`,
  )
  if (misses.length) {
    console.error(
      `\n${misses.length} town(s) have no Gazetteer place row:\n  ` +
        misses.join('\n  '),
    )
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
