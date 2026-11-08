#!/usr/bin/env node
/**
 * Build public/schools.json — the "about this school" card shown after a guess
 * — from the hand-written data/schools-seed.json plus Wikipedia + Wikidata.
 *
 *   npm run build-schools            # write public/schools.json
 *   npm run build-schools -- --dry-run   # fetch + report, write nothing
 *
 * For every town's PROMPT school (src/lib/schools.ts:promptSchool) it:
 *   1. resolves the English Wikipedia article (seed `wikipedia` override, else
 *      the top search hit — the dry run prints the mapping for review);
 *   2. reads the article's `Infobox university` (type, founded, enrollment,
 *      mascot, nickname, athletics) and `Infobox US university ranking`
 *      (U.S. News rank) — see build-schools-lib.mjs;
 *   3. asks Wikidata for the alumni with the most Wikipedia articles
 *      (people "educated at" the item, P69), unless the seed lists `alumni`.
 *
 * Responses are cached in data/.wikipedia-cache.json (gitignored) so a re-run
 * only hits the network for new schools; delete a cache entry to refresh it.
 * Wikipedia asks for a descriptive User-Agent and modest request rates; the
 * public Wikidata SPARQL endpoint times out on very large alumni sets, so the
 * query is retried with a higher sitelinks floor before giving up (no alumni
 * for that school — the card just omits the line).
 *
 * Output rows are sorted by school so a rebuild produces a minimal diff.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { promptSchool } from '../src/lib/schools.ts'
import {
  alumniQuery,
  parseAlumni,
  sortFacts,
  toSchoolFacts,
  validateSchoolSeed,
} from './build-schools-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SEED = path.join(ROOT, 'data', 'schools-seed.json')
const TOWNS = path.join(ROOT, 'public', 'towns.json')
const CACHE = path.join(ROOT, 'data', '.wikipedia-cache.json')
const OUT = path.join(ROOT, 'public', 'schools.json')
const USER_AGENT =
  'CampusPinShowdown/0.1 (+https://github.com/wardcrazy01894/CampusPinShowdown)'
const WIKI_API = 'https://en.wikipedia.org/w/api.php'
const SPARQL = 'https://query.wikidata.org/sparql'
/** Sitelinks floors tried in turn: UP when the alumni query times out (huge
 *  schools), DOWN when it comes back thin (small ones). */
const ALUMNI_FLOORS = [25, 60, 120]
const ALUMNI_FLOORS_SMALL = [8, 3]
/** Edition of the U.S. News list the Wikipedia ranking infobox reflects.
 *  Check Template:Infobox US university ranking when bumping. */
export const RANKING_EDITION = 2026

const DRY_RUN = process.argv.includes('--dry-run')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback
  return JSON.parse(await readFile(file, 'utf8'))
}

async function getJson(url, headers = {}, attempt = 1) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...headers,
      },
      signal: AbortSignal.timeout(90_000),
    })
    if (r.status === 429 || r.status >= 500) {
      if (attempt >= 3) throw new Error(`HTTP ${r.status}`)
      await sleep(2000 * attempt)
      return getJson(url, headers, attempt + 1)
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  } catch (e) {
    if (attempt >= 3 || /HTTP|timeout/i.test(String(e))) throw e
    await sleep(2000 * attempt)
    return getJson(url, headers, attempt + 1)
  }
}

const wikiUrl = (params) =>
  `${WIKI_API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`

async function resolveTitle(cache, name) {
  const key = `search|${name}`
  if (cache[key]) return cache[key]
  const j = await getJson(
    wikiUrl({ action: 'query', list: 'search', srsearch: name, srlimit: '1' }),
  )
  const hit = j.query?.search?.[0]?.title
  if (!hit) throw new Error(`no Wikipedia search hit for "${name}"`)
  cache[key] = hit
  await sleep(150)
  return hit
}

/** { title, wikitext, qid } following redirects; cached by requested title. */
async function fetchArticle(cache, title) {
  const key = `article|${title}`
  if (cache[key]) return cache[key]
  const j = await getJson(
    wikiUrl({
      action: 'query',
      prop: 'revisions|pageprops',
      rvprop: 'content',
      rvslots: 'main',
      ppprop: 'wikibase_item',
      redirects: '1',
      titles: title,
    }),
  )
  const page = j.query?.pages?.[0]
  if (!page || page.missing)
    throw new Error(`Wikipedia article "${title}" not found`)
  const article = {
    title: page.title,
    wikitext: page.revisions?.[0]?.slots?.main?.content ?? '',
    qid: page.pageprops?.wikibase_item,
  }
  cache[key] = article
  await sleep(150)
  return article
}

/**
 * Alumni strings for a Wikidata item, or [] when every attempt times out.
 * The cache holds the RAW bindings (like the article cache holds wikitext) so
 * a parser fix applies on the next build without refetching.
 */
async function fetchAlumni(cache, qid, school) {
  const key = `alumni|${qid}`
  if (cache[key]?.bindings) return parseAlumni(cache[key].bindings, 5)
  for (const floor of ALUMNI_FLOORS) {
    try {
      const j = await getJson(
        `${SPARQL}?format=json&query=${encodeURIComponent(alumniQuery(qid, floor))}`,
        { Accept: 'application/sparql-results+json' },
      )
      let bindings = j.results?.bindings ?? []
      for (const low of ALUMNI_FLOORS_SMALL) {
        if (parseAlumni(bindings, 5).length >= 3) break
        await sleep(1000)
        const j2 = await getJson(
          `${SPARQL}?format=json&query=${encodeURIComponent(alumniQuery(qid, low))}`,
          { Accept: 'application/sparql-results+json' },
        )
        bindings = j2.results?.bindings ?? []
      }
      cache[key] = { bindings }
      await sleep(1000)
      return parseAlumni(bindings, 5)
    } catch (e) {
      console.warn(`  ${school}: alumni query (floor ${floor}) failed: ${e}`)
      await sleep(3000)
    }
  }
  console.warn(`  ${school}: giving up on alumni`)
  cache[key] = { bindings: [] }
  return []
}

async function main() {
  const towns = (await readJson(TOWNS)).towns
  const wanted = [...new Set(towns.map(promptSchool))].sort()
  const seed = await readJson(SEED, [])
  const bySchool = new Map(seed.map((e) => [e.school, e]))
  const cache = await readJson(CACHE, {})
  const saveCache = () =>
    writeFile(CACHE, JSON.stringify(cache, null, 1) + '\n')

  const problems = validateSchoolSeed(seed, wanted)
  if (problems.length && !DRY_RUN) {
    console.error('Seed problems:\n  ' + problems.join('\n  '))
    process.exit(1)
  }
  if (problems.length)
    console.warn(`(dry run) ${problems.length} seed problem(s); continuing`)

  // Pass 1 — articles (fast). Print the name → title mapping for review.
  const articles = new Map()
  const failures = []
  for (const school of wanted) {
    try {
      const override = bySchool.get(school)?.wikipedia
      const title = override ?? (await resolveTitle(cache, school))
      const article = await fetchArticle(cache, title)
      articles.set(school, article)
      const flag = article.title === school ? '' : '   ← CHECK'
      console.log(`${school.padEnd(48)} → ${article.title}${flag}`)
    } catch (e) {
      failures.push(`${school}: ${e.message}`)
      console.error(`${school.padEnd(48)} !! ${e.message}`)
    }
    if (articles.size % 25 === 0) await saveCache()
  }
  await saveCache()

  // Pass 2 — alumni (slow; the public SPARQL endpoint is the bottleneck).
  const rows = []
  for (const [school, article] of articles) {
    const entry = bySchool.get(school) ?? { school, funFact: '' }
    try {
      const alumni =
        entry.alumni ??
        (article.qid ? await fetchAlumni(cache, article.qid, school) : [])
      rows.push(toSchoolFacts(entry, article.title, article.wikitext, alumni))
      await saveCache()
    } catch (e) {
      failures.push(`${school}: ${e.message}`)
      console.error(`${school}: ${e.message}`)
    }
  }
  await saveCache()

  if (DRY_RUN) {
    console.log(
      `\n(dry run) ${rows.length} rows built, ${failures.length} failure(s)`,
    )
    const miss = (k) =>
      rows.filter((r) => r[k] === undefined).map((r) => r.school)
    for (const k of [
      'type',
      'founded',
      'undergrad',
      'postgrad',
      'mascot',
      'nickname',
      'division',
      'conference',
      'ranking',
      'alumni',
    ])
      console.log(`  missing ${k} (${miss(k).length}): ${miss(k).join('; ')}`)
    if (failures.length) console.log('Failures:\n  ' + failures.join('\n  '))
    return
  }
  if (failures.length) {
    console.error('Build failed for:\n  ' + failures.join('\n  '))
    process.exit(1)
  }
  const out = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    attribution: `School facts from Wikipedia (CC BY-SA 4.0) and Wikidata (CC0); U.S. News & World Report Best Colleges ${RANKING_EDITION} ranks as recorded on Wikipedia. Fun facts: CampusPin Showdown.`,
    rankingEdition: RANKING_EDITION,
    schools: sortFacts(rows),
  }
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n')
  console.log(
    `\nWrote ${out.schools.length} schools → ${path.relative(ROOT, OUT)}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
