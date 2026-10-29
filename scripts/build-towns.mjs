#!/usr/bin/env node
/**
 * Build public/towns.json from the hand-curated data/towns-seed.json.
 *
 *   npm run build-towns
 *
 * For every seed entry without a manual lat/lng, geocodes "<Town>, <State>, USA"
 * with OpenStreetMap's Nominatim (free, no key; usage policy: ≤1 request/s and
 * an identifying User-Agent — https://operations.osmfoundation.org/policies/nominatim/).
 * Responses are cached in data/.nominatim-cache.json (gitignored) so re-runs
 * only hit the network for NEW towns. A town that can't be geocoded into its
 * state, or lands outside the lower 48, fails the build (exit 1) with the ids
 * listed — add a manual `lat`/`lng` to that seed entry and re-run.
 *
 * Output is sorted by id and coordinates are rounded to 4 dp, so a rebuild
 * produces a minimal, reviewable diff.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  validateSeed,
  nominatimQuery,
  pickResult,
  inConus,
  toTown,
  sortTowns,
  slug,
  censusMismatches,
} from './build-towns-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SEED = path.join(ROOT, 'data', 'towns-seed.json')
const CACHE = path.join(ROOT, 'data', '.nominatim-cache.json')
const OUT = path.join(ROOT, 'public', 'towns.json')
const CENSUS = path.join(ROOT, 'data', 'census-pins.json')
const USER_AGENT =
  'CampusPinShowdown/0.1 (+https://github.com/wardcrazy01894/CampusPinShowdown)'
const MIN_GAP_MS = 1100

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Cache key version: bump when the QUERY changes shape (params below), so
 * stale answers from an older query form are never reused.
 */
const QUERY_VERSION = 'v2'
const cacheKey = (query) => `${QUERY_VERSION}|${query}`

async function geocode(query, attempt = 1) {
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({
      q: query,
      format: 'jsonv2',
      // 10 (not 5): a same-named county/neighbourhood can crowd the real town
      // out of a short list; pickResult then has nothing valid to choose.
      limit: '10',
      countrycodes: 'us',
      addressdetails: '1',
      // Settlements only (state → neighbourhood): keeps university buildings,
      // roads and POIs out of the candidate list entirely.
      featureType: 'settlement',
    })
  let r
  try {
    r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e) {
    if (attempt >= 2) throw e
    console.log(`  (network error, retrying) ${String(e)}`)
    await sleep(5_000)
    return geocode(query, attempt + 1)
  }
  if (r.status === 429 || r.status >= 500) {
    if (attempt >= 2)
      throw new Error(`Nominatim HTTP ${r.status} for "${query}"`)
    console.log(`  (HTTP ${r.status}, backing off 10 s)`)
    await sleep(10_000)
    return geocode(query, attempt + 1)
  }
  if (!r.ok) throw new Error(`Nominatim HTTP ${r.status} for "${query}"`)
  return r.json()
}

async function main() {
  const seed = JSON.parse(await readFile(SEED, 'utf8'))
  const problems = validateSeed(seed)
  if (problems.length) {
    console.error('Seed is invalid:\n  ' + problems.join('\n  '))
    process.exit(1)
  }

  const cache = existsSync(CACHE)
    ? JSON.parse(await readFile(CACHE, 'utf8'))
    : {}
  const towns = []
  const misses = []
  let fetched = 0

  for (const entry of seed) {
    const id = slug(entry.name, entry.stateCode)
    if (entry.lat != null) {
      towns.push(
        toTown(entry, { lat: entry.lat, lng: entry.lng, source: 'manual' }),
      )
      continue
    }
    const q = nominatimQuery(entry)
    const k = cacheKey(q)
    if (!cache[k]) {
      if (fetched > 0) await sleep(MIN_GAP_MS)
      process.stdout.write(`geocoding ${id} … `)
      cache[k] = await geocode(q)
      fetched++
      await writeFile(CACHE, JSON.stringify(cache, null, 1))
      console.log(`${cache[k].length} hits`)
    }
    const hit = pickResult(cache[k], entry)
    if (!hit) {
      misses.push(`${id}: no settlement hit in ${entry.stateCode} for "${q}"`)
      continue
    }
    const coords = {
      lat: Number(hit.lat),
      lng: Number(hit.lon),
      source: 'nominatim',
    }
    if (!inConus(coords)) {
      misses.push(
        `${id}: ${coords.lat},${coords.lng} is outside the lower-48 play box`,
      )
      continue
    }
    towns.push(toTown(entry, coords))
  }

  // Independent cross-check: every pin must agree with the US Census Gazetteer
  // internal point for that place (data/census-pins.json). This is what stops
  // a same-named county / neighbourhood / hamlet from shipping.
  const census = JSON.parse(await readFile(CENSUS, 'utf8')).pins
  for (const m of censusMismatches(towns, census)) {
    misses.push(`${m.id}: ${m.reason}`)
  }

  if (misses.length) {
    console.error(
      `\n${misses.length} town(s) could not be placed — add a manual lat/lng in data/towns-seed.json:\n  ` +
        misses.join('\n  '),
    )
    process.exit(1)
  }

  const file = {
    version: 1,
    region: 'usa',
    attribution:
      'Town coordinates © OpenStreetMap contributors (ODbL), geocoded via Nominatim. School/town curation: CampusPin Showdown.',
    towns: sortTowns(towns),
  }
  await writeFile(OUT, JSON.stringify(file, null, 2) + '\n')
  const by = (d) => towns.filter((t) => t.difficulty === d).length
  console.log(
    `\nWrote ${towns.length} towns (${by('easy')} easy / ${by('medium')} medium / ${by('hard')} hard) → public/towns.json (${fetched} new geocodes)`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
