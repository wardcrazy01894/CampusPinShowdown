/**
 * Pure helpers for scripts/build-schools.mjs — parsing a school's Wikipedia
 * article (the `Infobox university` and `Infobox US university ranking`
 * templates) and its Wikidata alumni into a SchoolFacts row for
 * public/schools.json. No I/O here; unit-tested in build-schools-lib.test.mjs.
 *
 * The wikitext handling is deliberately small: it needs to read a dozen
 * infobox parameters, not render Wikipedia. Anything it cannot read is left
 * undefined and the UI simply omits that stat.
 */

/**
 * The first `{{<name> ...}}` template in `wikitext`, brace-matched so nested
 * templates ({{hlist|…}}, {{cite web|…}}) stay inside. Case-insensitive name
 * match on a whole word, so "Infobox university" does not match
 * "Infobox US university ranking" (and vice versa). Null when absent.
 */
export function extractTemplate(wikitext, name) {
  const re = new RegExp(
    `\\{\\{\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?=[|}\\n]|<!--)`,
    'i',
  )
  const m = re.exec(wikitext)
  if (!m) return null
  let depth = 0
  for (let i = m.index; i < wikitext.length - 1; i++) {
    const pair = wikitext.slice(i, i + 2)
    if (pair === '{{') {
      depth++
      i++
    } else if (pair === '}}') {
      depth--
      i++
      if (depth === 0) return wikitext.slice(m.index, i + 1)
    }
  }
  return null
}

/**
 * Top-level `| key = value` parameters of a template → Map. Pipes inside
 * nested {{ }} / [[ ]] belong to the value; HTML comments between parameters
 * are dropped; values keep their raw wikitext (see `plain`).
 */
export function templateParams(template) {
  const params = new Map()
  if (!template) return params
  const body = template.replace(/<!--[\s\S]*?-->/g, '').slice(2, -2)
  const parts = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2)
    if (two === '{{' || two === '[[') {
      depth++
      cur += two
      i++
    } else if (two === '}}' || two === ']]') {
      depth--
      cur += two
      i++
    } else if (body[i] === '|' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += body[i]
    }
  }
  parts.push(cur)
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key) params.set(key, value)
  }
  return params
}

/** Templates whose first positional argument is the thing we want to show. */
const UNWRAP = /^(nowrap|nobr|small|big|lang|em|strong|abbr)$/i
/** List templates: positional arguments joined with ", ". */
const LISTS =
  /^(hlist|ubl|unbulleted list|plainlist|flatlist|cslist|bulleted list)$/i
/** Date templates: the first positional argument is the year. */
const DATES = /^(start date( and age)?|start date and years ago|birth date)$/i

function renderTemplate(inner) {
  const args = splitTopLevel(inner)
  const name = args[0].trim()
  const positional = args
    .slice(1)
    .filter((a) => !/^\s*[a-z_]+\s*=/i.test(a))
    .map((a) => a.trim())
    .filter(Boolean)
  if (LISTS.test(name)) return positional.join(', ')
  if (DATES.test(name)) return positional[0] ?? ''
  if (UNWRAP.test(name)) return positional[0] ?? ''
  return ''
}

function splitTopLevel(s) {
  const out = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2)
    if (two === '{{' || two === '[[') {
      depth++
      cur += two
      i++
    } else if (two === '}}' || two === ']]') {
      depth--
      cur += two
      i++
    } else if (s[i] === '|' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += s[i]
  }
  out.push(cur)
  return out
}

/**
 * Wikitext → plain text: refs, comments and HTML tags gone; `[[a|b]]` → b;
 * list/date/nowrap templates rendered, every other template dropped;
 * `<br>` → ", "; entities and quotes cleaned; whitespace collapsed.
 */
export function plain(wikitext) {
  if (!wikitext) return ''
  let s = String(wikitext)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<br\s*\/?>/gi, ', ')
  // Innermost templates first so nested ones resolve.
  for (let guard = 0; guard < 20 && /\{\{/.test(s); guard++) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => renderTemplate(inner))
  }
  s = s
    .replace(/\[\[(?:[^[\]|]*\|)?([^[\]]*)\]\]/g, '$1')
    .replace(/\[https?:[^\s\]]*\s*([^\]]*)\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/\s*,\s*(?=,|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return s.replace(/^,\s*|\s*,$/g, '').trim()
}

/**
 * "34,184 (fall 2025)" → { value: 34184, asOf: 'fall 2025' }. The count is
 * the first number that is NOT a bare 4-digit year in parentheses; the
 * as-of term is "(fall|spring) YYYY" or a bare "(YYYY)". Null when no count.
 */
export function parseCount(raw) {
  const s = plain(raw)
  if (!s) return null
  const asOfMatch = s.match(
    /\(\s*(?:(fall|spring|autumn|summer|winter)\s+)?((?:19|20)\d{2})(?:[–-]\d{2,4})?\s*\)/i,
  )
  const asOf = asOfMatch
    ? `${asOfMatch[1] ? asOfMatch[1].toLowerCase() + ' ' : ''}${asOfMatch[2]}`
    : undefined
  const withoutAsOf = asOfMatch ? s.replace(asOfMatch[0], ' ') : s
  const num = withoutAsOf.match(/\d{1,3}(?:,\d{3})+|\d+/)
  if (!num) return null
  return { value: Number(num[0].replace(/,/g, '')), asOf }
}

/**
 * "[[NCAA Division I FBS]] – [[Big 12 Conference|Big 12]]" →
 * { division: 'NCAA Division I FBS', conference: 'Big 12' }. Lists keep the
 * first entry (the primary conference); separators may be –, —, - or ·.
 */
export function parseAthletics(raw) {
  const s = plain(raw)
  if (!s) return null
  // The division is recognised, never copied: infobox lines come in every
  // shape ("NCAA Division I FBS –, CUSA", "NCAA Division I FCSIvy League",
  // "National Collegiate Athletic Association, Division III, …",
  // "NCAA:, Division II: GLIAC", "NCAA Division I (FCS) Patriot League").
  const m = s.match(
    /(?:NCAA|National Collegiate Athletic Association)?[\s:,]*Division\s+(I{1,3})(?!I)\s*(?:\(\s*(FBS|FCS)\s*\)|(FBS|FCS))?|\b(NAIA|NJCAA|USCAA|NCCAA)\b/i,
  )
  if (!m) return null
  const division = m[4]
    ? m[4].toUpperCase()
    : `NCAA Division ${m[1].toUpperCase()}${m[2] || m[3] ? ' ' + (m[2] || m[3]).toUpperCase() : ''}`
  // The conference is the first thing after the division, up to the next
  // list separator; never another "Division …" entry, never a bare "NCAA".
  const rest = s.slice(m.index + m[0].length).replace(/^[\s–—\-:,·]+/, '')
  let conference = rest.split(/\s*[,;·–—]\s*|\s+-\s+|\s*:\s*/)[0].trim()
  conference = conference.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
  // "Patriot League CWPA" (no separator at all) → keep through the first
  // conference-ish noun.
  const noun = conference.match(
    /^(.*?\b(?:Conference|League|Association|Athletic|Athletics)\b)/i,
  )
  if (noun && noun[1].length < conference.length) conference = noun[1].trim()
  if (
    !conference ||
    /^(NCAA|Division\b.*)$/i.test(conference) ||
    conference.length > 40
  )
    conference = undefined
  return { division, conference }
}

const RANKING_LISTS = [
  ['USNWR_NU', 'National Universities'],
  ['USNWR_LA', 'National Liberal Arts Colleges'],
  ['USNWR_RU', 'Regional Universities'],
  ['USNWR_RC', 'Regional Colleges'],
  // Newer template versions carry one regional rank without saying which of
  // the two regional lists (universities / colleges) it is from.
  ['USNWR_REG', 'Regional'],
]

/** U.S. News rank from the ranking infobox params, best-known list first. */
export function parseRanking(params) {
  if (!params) return null
  for (const [key, list] of RANKING_LISTS) {
    const raw = params.get(key)
    if (!raw) continue
    const m = plain(raw).match(/\d+/)
    if (m) return { list, rank: Number(m[0]) }
  }
  return null
}

/**
 * The infobox parameter that describes athletics: `sporting_affiliations`
 * (or its aliases), else a generic `affiliations` line only when it is
 * clearly about sports (NCAA/NAIA…) — that key also carries church and
 * consortium memberships.
 */
export function athleticsParam(p) {
  const direct =
    p.get('sporting_affiliations') ??
    p.get('athletics_affiliations') ??
    p.get('affiliations_athletics')
  if (direct) return direct
  const generic = p.get('affiliations')
  return generic && /NCAA|NAIA|NJCAA|USCAA|NCCAA/i.test(generic)
    ? generic
    : undefined
}

/** 'Public' | 'Private' | undefined. Service academies are public. */
export function parseType(raw) {
  const s = plain(raw).toLowerCase()
  if (!s) return undefined
  const priv = /private/.test(s)
  const pub = /public|federal|\bstate\b|military academy|service academy/.test(
    s,
  )
  // Both words ("private, state-assisted", Delaware) → unknown; the seed can
  // pin a `type` override.
  if (priv && pub) return undefined
  if (priv) return 'Private'
  if (pub) return 'Public'
  return undefined
}

/** First plausible founding year in the text, else undefined. */
export function parseYear(raw) {
  const m = plain(raw).match(/\b(1[5-9]\d{2}|20\d{2})\b/)
  return m ? Number(m[1]) : undefined
}

/**
 * SPARQL: humans educated at `qid` (P69), ranked by how many Wikipedias have
 * an article about them (a fame proxy that needs no editorial list). The
 * sitelinks floor keeps the sort small enough for the public endpoint on
 * schools with tens of thousands of alumni items.
 */
export function alumniQuery(qid, minSitelinks) {
  return `SELECT ?p ?pLabel ?n ?descr WHERE {
  ?p wdt:P69 wd:${qid} .
  ?p wikibase:sitelinks ?n .
  FILTER(?n >= ${minSitelinks})
  OPTIONAL { ?p schema:description ?descr FILTER(LANG(?descr) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} ORDER BY DESC(?n) LIMIT 12`
}

/**
 * SPARQL bindings → up to `n` strings "Name (short role)". The role is the
 * Wikidata description with nationality, dates and trailing clauses trimmed,
 * cut to at most two comma-separated parts. Bare Q-ids (no English label)
 * are skipped; duplicates collapse.
 */
export function parseAlumni(bindings, n = 5) {
  const out = []
  const seen = new Set()
  for (const b of bindings ?? []) {
    const name = b.pLabel?.value?.trim()
    if (!name || /^Q\d+$/.test(name) || seen.has(name)) continue
    seen.add(name)
    if (isBlockedAlumnus(name, b.descr?.value)) continue
    const role = shortRole(b.descr?.value)
    out.push(role ? `${name} (${role})` : name)
    if (out.length >= n) break
  }
  return out
}

/**
 * Alumni never shown, whatever their sitelinks count: a casual game should
 * not put a school next to a serial killer. Names (exact Wikidata labels)
 * plus description keywords.
 */
export const ALUMNI_BLOCKLIST = new Set([
  'Ted Bundy',
  'Jeffrey Dahmer',
  'Harvey Weinstein',
  'George Floyd',
  'Matthew Shepard',
  'George Jung',
  'Robert Hanssen',
  'Anwar al-Awlaki',
  'Omarosa Manigault Newman',
])
const BLOCKED_ROLE =
  /serial killer|murder|sex offender|sexual|killed|terroris|extremist|\bspy\b|criminal|convicted|rapist|drug (?:lord|trafficker|smuggler)|fraudster|assassin|shooter|cult leader|war criminal|neo-nazi|white supremacist/i

export function isBlockedAlumnus(name, descr) {
  return ALUMNI_BLOCKLIST.has(name) || BLOCKED_ROLE.test(descr ?? '')
}

const ROLE_MAX = 40
/** Capitalised demonyms ("Turkish", "Mexican", "Jewish-American", "Iraqi"),
 *  optionally joined by "and"/"or", at the start of a description. */
const DEMONYM =
  /^(?:(?:[A-Z][a-z]+-)?[A-Z][a-z]+(?:ian|ean|ish|ese|an|i|ch|ic)\b(?:\s+(?:and|or))?\s*)+/

function shortRole(descr) {
  if (!descr) return ''
  let s = descr
    .replace(/\s*\((?:born|died|b\.|d\.|c\.|\d)[^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s*[;&]\s.*$/, '')
    .replace(/,?\s+who\s.*$/, '')
    .replace(
      /\s*\(?\b(?:from|since|in)\s+\d{4}(?:\s*(?:to|–|-)\s*(?:\d{4}|present))?\)?/g,
      '',
    )
    .replace(/\s*,?\s*(?:Professor|professor|(?<!co-)founder|CEO) .*$/, '')
    .replace(/^\s*(?:\d+(?:st|nd|rd|th)[- ]century\s+)?/, '')
    .replace(/\b\d+(?:st|nd|rd|th)\s+/g, '')
    .replace(
      /^\s*(?:the\s+)?(?:and\s+)?(?:current|incumbent|former|retired)\s+/i,
      '',
    )
    .replace(/^\s*(?:the|a|an)\s+/i, '')
    .replace(/^\s*(?:former|retired|late)\s+/i, '')
    .replace(/^\s*(?:U\.S\.|US|United States)\s+/, '')
    .replace(DEMONYM, '')
    .replace(/^\s*(?:former|retired)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = s.split(/\s*,\s*/).filter(Boolean)
  s = parts.slice(0, 2).join(', ')
  if (s.length > ROLE_MAX) s = parts[0]
  if (s.length > ROLE_MAX) s = s.split(/\s+and\s+/)[0]
  if (s.length > ROLE_MAX) {
    s = s.slice(0, ROLE_MAX)
    s = s.slice(0, s.lastIndexOf(' ')) || s
  }
  s = s
    .replace(/[.,\s]+$/, '')
    // A cut can leave a dangling function word ("…Senate from").
    .replace(/\s+(?:from|of|and|in|for|the|a|an|to|at|by|with)$/i, '')
    .trim()
  // Nothing informative left ("the", "9th") → no role at all.
  return /^(?:the|a|an|\d+(?:st|nd|rd|th)?)$/i.test(s) || s.length < 3 ? '' : s
}

/**
 * One public/schools.json row. `seed` = the schools-seed entry (school,
 * funFact, optional alumni override); `title` = the resolved article title;
 * `alumni` = parseAlumni output. Fields the article does not provide are
 * omitted rather than nulled, so the shipped JSON stays small.
 */
export function toSchoolFacts(seed, title, wikitext, alumni) {
  const box = extractTemplate(wikitext, 'Infobox university')
  if (!box)
    throw new Error(`${seed.school}: no "Infobox university" in "${title}"`)
  const p = templateParams(box)
  const rank = parseRanking(
    templateParams(extractTemplate(wikitext, 'Infobox US university ranking')),
  )
  const under = parseCount(p.get('undergrad'))
  const post = parseCount(p.get('postgrad'))
  // Many infoboxes carry only the total; kept separately so the card can say
  // "23,150 students" when the split is unknown.
  const total = parseCount(p.get('students') ?? p.get('enrollment'))
  const ath = parseAthletics(athleticsParam(p))
  const nickname = cleanNickname(
    plain(
      p.get('athletics_nickname') ??
        p.get('sports_nickname') ??
        p.get('nickname'),
    ),
  )
  const mascot = cleanMascot(plain(p.get('mascot') ?? p.get('mascots')))
  const row = {
    school: seed.school,
    wikipedia: title,
    funFact: seed.funFact,
  }
  const put = (k, v) => {
    if (v !== undefined && v !== null && v !== '') row[k] = v
  }
  put('type', seed.type ?? parseType(p.get('type')))
  put('founded', parseYear(p.get('established') ?? p.get('founded')))
  put('undergrad', under?.value)
  put('postgrad', post?.value)
  put('students', total?.value)
  put('enrollmentAsOf', under?.asOf ?? post?.asOf ?? total?.asOf)
  put('mascot', mascot)
  put('nickname', nickname)
  put('division', ath?.division)
  put('conference', ath?.conference)
  put('ranking', rank ?? undefined)
  const al = seed.alumni ?? alumni
  if (al && al.length) row.alumni = al
  return row
}

/** "Penn State: Nittany Lions, Lady Lions, …" → "Nittany Lions";
 *  "Bulldogs and Lady Bulldogs" → "Bulldogs". Empty when nothing sane remains. */
export function cleanNickname(s) {
  let n = (s || '')
    .replace(/^[^:,]{0,40}:\s*/, '')
    .split(/\s*[,;·]\s*/)[0]
    .replace(/\s+(?:and|&)\s+(?:the\s+)?Lady\s.*$/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .trim()
  return n.length > 0 && n.length <= 40 ? n : ''
}

/** "Judge Indy and Judge Belle (live bears), Bruiser and Marigold (costumed)"
 *  → "Judge Indy and Judge Belle, Bruiser and Marigold"; at most two items,
 *  parentheticals dropped, capped at 60 characters. */
export function cleanMascot(s) {
  const items = (s || '')
    .split(/\s*[,;·]\s*/)
    .map((x) => x.replace(/\s*\([^)]*\)\s*/g, ' ').trim())
    .filter((x) => x && !/^(none|no mascot|n\/a)$/i.test(x))
  let m = items.slice(0, 2).join(', ')
  if (m.length > 60) m = items[0]
  return m.length > 0 && m.length <= 60 ? m : ''
}

const FUN_FACT_MIN = 20
const FUN_FACT_MAX = 320

/**
 * Seed problems as human-readable strings (empty = valid): every prompt
 * school in `wanted` has exactly one entry, no entry is for an unknown
 * school, and every funFact is a sentence of sane length.
 */
export function validateSchoolSeed(seed, wanted) {
  const problems = []
  const seen = new Map()
  const wantedSet = new Set(wanted)
  for (const e of seed) {
    if (!e.school) {
      problems.push(`entry without a school: ${JSON.stringify(e)}`)
      continue
    }
    if (seen.has(e.school)) problems.push(`duplicate school "${e.school}"`)
    seen.set(e.school, e)
    if (!wantedSet.has(e.school))
      problems.push(`"${e.school}" is not a prompt school of any town`)
    const f = e.funFact
    if (typeof f !== 'string' || f.trim().length < FUN_FACT_MIN)
      problems.push(`"${e.school}": funFact missing or too short`)
    else if (f.length > FUN_FACT_MAX)
      problems.push(
        `"${e.school}": funFact too long (${f.length} > ${FUN_FACT_MAX})`,
      )
    if (
      e.alumni !== undefined &&
      (!Array.isArray(e.alumni) || e.alumni.some((a) => typeof a !== 'string'))
    )
      problems.push(`"${e.school}": alumni must be a list of strings`)
    if (e.type !== undefined && !['Public', 'Private'].includes(e.type))
      problems.push(`"${e.school}": type must be Public or Private`)
  }
  for (const w of wanted)
    if (!seen.has(w)) problems.push(`"${w}" is missing from the seed`)
  return problems
}

/** Rows sorted by school name (locale-independent) for a minimal diff. */
export function sortFacts(rows) {
  return [...rows].sort((a, b) =>
    a.school < b.school ? -1 : a.school > b.school ? 1 : 0,
  )
}
