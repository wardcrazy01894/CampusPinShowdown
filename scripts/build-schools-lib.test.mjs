import { describe, it, expect } from 'vitest'
import {
  extractTemplate,
  templateParams,
  plain,
  parseCount,
  parseAthletics,
  parseRanking,
  parseType,
  parseYear,
  parseAlumni,
  alumniQuery,
  athleticsParam,
  isBlockedAlumnus,
  cleanNickname,
  cleanMascot,
  toSchoolFacts,
  validateSchoolSeed,
  sortFacts,
} from './build-schools-lib.mjs'

const INFOBOX = `{{Short description|Public university in Lubbock, Texas}}
{{Infobox university
 | name = Texas Tech University
 | type = [[Public university|Public]] [[research university]]<ref>{{cite web |url=x |title=y}}</ref>
 | established = {{Start date and age|1923|02|10|br=y}}
 | undergrad = 34,184 (fall 2025)<ref name="EnrollmentCount"/>
 | postgrad = 8,271 (fall 2025)<ref name="EnrollmentCount"/>
 | mascot = {{hlist|[[The Masked Rider|Masked Rider]]|[[Raider Red]]}}
 | sporting_affiliations = [[NCAA Division I FBS]] – [[Big 12 Conference|Big 12]]
 | nickname = [[Texas Tech Red Raiders|Red Raiders]]
 | colors = Scarlet and black<ref name="c"/><br/>{{college color boxes|Texas Tech Red Raiders}}
 | city = [[Lubbock, Texas]]
}}
Body text.
{{Infobox US university ranking <!-- National rankings -->
| Forbes_NU = 149
| USNWR_NU = 186 <small>(tie)</small>
| Wamo_NU = 426
}}
More body.`

describe('extractTemplate', () => {
  it('returns the brace-matched template by (case-insensitive) name', () => {
    const t = extractTemplate(INFOBOX, 'Infobox university')
    expect(t.startsWith('{{Infobox university')).toBe(true)
    expect(t.endsWith('}}')).toBe(true)
    expect(t).toContain('Raider Red]]}}') // nested template survived
    expect(t).not.toContain('Body text')
  })
  it('does not confuse the ranking infobox with the university one', () => {
    const r = extractTemplate(INFOBOX, 'Infobox US university ranking')
    expect(r).toContain('USNWR_NU')
    expect(r).not.toContain('undergrad')
  })
  it('returns null when absent', () => {
    expect(extractTemplate('nothing here', 'Infobox university')).toBeNull()
  })
})

describe('templateParams', () => {
  it('splits top-level parameters only (pipes inside [[ ]] / {{ }} stay)', () => {
    const p = templateParams(extractTemplate(INFOBOX, 'Infobox university'))
    expect(p.get('name')).toBe('Texas Tech University')
    expect(p.get('mascot')).toBe(
      '{{hlist|[[The Masked Rider|Masked Rider]]|[[Raider Red]]}}',
    )
    expect(p.get('sporting_affiliations')).toBe(
      '[[NCAA Division I FBS]] – [[Big 12 Conference|Big 12]]',
    )
  })
  it('ignores HTML comments between parameters', () => {
    const p = templateParams(
      extractTemplate(INFOBOX, 'Infobox US university ranking'),
    )
    expect(p.get('USNWR_NU')).toBe('186 <small>(tie)</small>')
    expect(p.get('Forbes_NU')).toBe('149')
  })
})

describe('plain', () => {
  it('strips refs, links, comments, tags and simple templates', () => {
    expect(
      plain(
        '[[Public university|Public]] [[research university]]<ref>{{cite web|url=x}}</ref>',
      ),
    ).toBe('Public research university')
    expect(plain('34,184 (fall 2025)<ref name="E"/>')).toBe(
      '34,184 (fall 2025)',
    )
    expect(
      plain('{{hlist|[[The Masked Rider|Masked Rider]]|[[Raider Red]]}}'),
    ).toBe('Masked Rider, Raider Red')
    expect(plain('{{Start date and age|1923|02|10|br=y}}')).toBe('1923')
    expect(
      plain(
        'Scarlet and black<br/>{{college color boxes|Texas Tech Red Raiders}}',
      ),
    ).toBe('Scarlet and black')
    expect(plain("''The Daily Toreador''<!-- hidden -->&nbsp;x")).toBe(
      'The Daily Toreador x',
    )
    expect(plain('{{nowrap|Big Ten}} and {{ubl|A|B}}')).toBe('Big Ten and A, B')
  })
})

describe('parseCount', () => {
  it('reads the first number and the as-of term', () => {
    expect(parseCount('34,184 (fall 2025)<ref name="E"/>')).toEqual({
      value: 34184,
      asOf: 'fall 2025',
    })
    expect(parseCount('2,592 (Fall 2023)')).toEqual({
      value: 2592,
      asOf: 'fall 2023',
    })
    expect(parseCount('450')).toEqual({ value: 450, asOf: undefined })
    expect(parseCount('')).toBeNull()
    expect(parseCount(undefined)).toBeNull()
  })
  it('never mistakes a footnote year for the count', () => {
    expect(parseCount('(2024) 1,234')).toEqual({ value: 1234, asOf: '2024' })
  })
})

describe('parseAthletics', () => {
  it('splits "<division> – <conference>"', () => {
    expect(
      parseAthletics('[[NCAA Division I FBS]] – [[Big 12 Conference|Big 12]]'),
    ).toEqual({
      division: 'NCAA Division I FBS',
      conference: 'Big 12',
    })
    expect(
      parseAthletics(
        '[[NCAA Division III]] – [[Ohio Athletic Conference|OAC]]',
      ),
    ).toEqual({
      division: 'NCAA Division III',
      conference: 'OAC',
    })
  })
  it('takes the first entry of a list and copes with hyphen/em-dash separators', () => {
    expect(
      parseAthletics(
        '{{ubl|[[NCAA Division I FBS]] - [[Atlantic Coast Conference|ACC]]|[[NCAA Division I]] – [[Hockey East]]}}',
      ),
    ).toEqual({ division: 'NCAA Division I FBS', conference: 'ACC' })
    expect(parseAthletics('[[NAIA]] — [[Frontier Conference]]')).toEqual({
      division: 'NAIA',
      conference: 'Frontier Conference',
    })
  })
  it('keeps only the primary conference when several are listed', () => {
    expect(
      parseAthletics(
        '{{hlist|[[NCAA Division I FBS]] – [[Big Ten Conference|Big Ten]]|[[CWPA]]}}',
      ),
    ).toEqual({ division: 'NCAA Division I FBS', conference: 'Big Ten' })
  })
  it('recognises the division instead of copying the line, whatever the separators', () => {
    const cases = [
      [
        '[[NCAA Division I FBS]] –, [[CUSA]], ESCHL',
        'NCAA Division I FBS',
        'CUSA',
      ],
      [
        '[[NCAA Division I FCS]][[Ivy League]], ECAC Hockey',
        'NCAA Division I FCS',
        'Ivy League',
      ],
      [
        '[[National Collegiate Athletic Association]], [[Division III]], [[American Rivers Conference]]',
        'NCAA Division III',
        'American Rivers Conference',
      ],
      [
        'NCAA:, Division II: GLIAC, Division I: CCHA',
        'NCAA Division II',
        'GLIAC',
      ],
      [
        'NCAA Division I (FCS) Patriot League CWPA',
        'NCAA Division I FCS',
        'Patriot League',
      ],
      ['[[NCAA Division III]][[WIAC]]', 'NCAA Division III', 'WIAC'],
      [
        '[[NCAA Division I FBS]] independent',
        'NCAA Division I FBS',
        'independent',
      ],
    ]
    for (const [raw, division, conference] of cases)
      expect(parseAthletics(raw), raw).toEqual({ division, conference })
  })
  it('returns null when there is no recognisable division', () => {
    expect(parseAthletics('20 varsity teams')).toBeNull()
    expect(parseAthletics(undefined)).toBeNull()
  })
})

describe('parseRanking', () => {
  it('prefers national universities, then liberal arts, then regional', () => {
    expect(
      parseRanking(
        new Map([
          ['USNWR_NU', '186 <small>(tie)</small>'],
          ['Forbes', '1'],
        ]),
      ),
    ).toEqual({
      list: 'National Universities',
      rank: 186,
    })
    expect(parseRanking(new Map([['USNWR_LA', '16']]))).toEqual({
      list: 'National Liberal Arts Colleges',
      rank: 16,
    })
    expect(
      parseRanking(
        new Map([
          ['USNWR_RU', '12'],
          ['USNWR_RC', '3'],
        ]),
      ),
    ).toEqual({
      list: 'Regional Universities',
      rank: 12,
    })
    expect(parseRanking(new Map([['USNWR_RC', '3']]))).toEqual({
      list: 'Regional Colleges',
      rank: 3,
    })
  })
  it('reads the regional rank (USNWR_REG) as a plain "Regional" list', () => {
    expect(
      parseRanking(
        new Map([
          ['USNWR_REG', '3'],
          ['Forbes', '256'],
        ]),
      ),
    ).toEqual({
      list: 'Regional',
      rank: 3,
    })
  })
  it('returns null for unranked or missing', () => {
    expect(parseRanking(new Map([['USNWR_NU', 'Unranked']]))).toBeNull()
    expect(parseRanking(null)).toBeNull()
  })
})

describe('athleticsParam', () => {
  it('prefers sporting_affiliations, then an `affiliations` line that is about athletics', () => {
    expect(
      athleticsParam(
        new Map([
          ['sporting_affiliations', '[[NCAA Division I]] – [[Big Ten]]'],
          ['affiliations', '[[AAU]]'],
        ]),
      ),
    ).toBe('[[NCAA Division I]] – [[Big Ten]]')
    expect(
      athleticsParam(
        new Map([
          ['affiliations', '[[NCAA Division II]] – [[Peach Belt Conference]]'],
        ]),
      ),
    ).toBe('[[NCAA Division II]] – [[Peach Belt Conference]]')
    expect(
      athleticsParam(new Map([['affiliations', '[[Church of the Brethren]]']])),
    ).toBeUndefined()
    expect(
      athleticsParam(
        new Map([['affiliations', '[[NAIA]] – [[Frontier Conference]]']]),
      ),
    ).toBe('[[NAIA]] – [[Frontier Conference]]')
  })
})

describe('parseType / parseYear', () => {
  it('reduces the type to Public or Private', () => {
    expect(parseType('[[Public university|Public]] [[land-grant]]')).toBe(
      'Public',
    )
    expect(parseType('[[Private university|Private]] [[Jesuit]]')).toBe(
      'Private',
    )
    expect(parseType('[[Federal service academy]]')).toBe('Public')
    // Both words (Delaware: "private, state-assisted") → unknown; the seed decides.
    expect(
      parseType('[[Private university|Private]] state-assisted'),
    ).toBeUndefined()
    expect(parseType('[[Public university|Public]] state-related')).toBe(
      'Public',
    )
    expect(parseType(undefined)).toBeUndefined()
  })
  it('finds the founding year', () => {
    expect(parseYear('{{Start date and age|1923|02|10|br=y}}')).toBe(1923)
    expect(parseYear('1636<ref>x</ref>')).toBe(1636)
    expect(parseYear('unknown')).toBeUndefined()
  })
})

describe('alumni', () => {
  it('builds a SPARQL query for people educated at the item, most-linked first', () => {
    const q = alumniQuery('Q739627', 40)
    expect(q).toContain('wdt:P69 wd:Q739627')
    expect(q).toContain('?n >= 40')
    expect(q).toMatch(/ORDER BY DESC\(\?n\)/)
  })
  it('formats bindings as "Name (short role)", dropping dates and dedupes', () => {
    const rows = [
      {
        pLabel: { value: 'Gene Kelly' },
        n: { value: '87' },
        descr: {
          value:
            'American dancer, actor, singer, director and choreographer (1912–1996)',
        },
      },
      {
        pLabel: { value: 'Paul Berg' },
        n: { value: '67' },
        descr: {
          value:
            'American biochemist, Professor emeritus at Stanford University & Nobel laureate in Chemistry (1926–2023)',
        },
      },
      {
        pLabel: { value: 'Rick Santorum' },
        n: { value: '46' },
        descr: { value: 'American politician and commentator (born 1958)' },
      },
      {
        pLabel: { value: 'Rick Santorum' },
        n: { value: '46' },
        descr: { value: 'dup' },
      },
      { pLabel: { value: 'Q12345' }, n: { value: '40' } },
      { pLabel: { value: 'Nobody' }, n: { value: '30' } },
    ]
    expect(parseAlumni(rows, 3)).toEqual([
      'Gene Kelly (dancer, actor)',
      'Paul Berg (biochemist)',
      'Rick Santorum (politician and commentator)',
    ])
    // "co-founder" keeps its head; a trailing "founder of …" clause is cut.
    expect(
      parseAlumni([
        {
          pLabel: { value: 'Jimmy Wales' },
          n: { value: '90' },
          descr: { value: 'co-founder of Wikipedia (born 1966)' },
        },
        {
          pLabel: { value: 'Ann Doe' },
          n: { value: '50' },
          descr: { value: 'American chemist, founder of Doe Labs' },
        },
      ]),
    ).toEqual(['Jimmy Wales (co-founder of Wikipedia)', 'Ann Doe (chemist)'])
    // Unlabelled items (bare Q-ids) are skipped; a short list is fine.
    expect(parseAlumni(rows.slice(4), 5)).toEqual(['Nobody'])
  })
})

describe('alumni hygiene', () => {
  it('drops blocklisted names and descriptions a school would not want next to its name', () => {
    const b = (name, descr) => ({
      pLabel: { value: name },
      n: { value: '50' },
      descr: { value: descr },
    })
    expect(
      parseAlumni([
        b('Ted Bundy', 'American serial killer (1946–1989)'),
        b('Some Spy', 'American FBI agent and spy for the Soviet Union'),
        b('Fine Person', 'American actress'),
      ]),
    ).toEqual(['Fine Person (actress)'])
    expect(isBlockedAlumnus('Jeffrey Dahmer', '')).toBe(true)
    expect(isBlockedAlumnus('Anyone', 'American politician')).toBe(false)
  })
  it('trims roles: demonyms, ordinals, "who …", date ranges, and caps at ~40 chars', () => {
    const r = (d) =>
      parseAlumni([
        { pLabel: { value: 'X' }, n: { value: '9' }, descr: { value: d } },
      ])[0]
    expect(
      r(
        'Turkish politician, who has been the first female and 22nd prime minister of the country',
      ),
    ).toBe('X (politician)')
    expect(
      r(
        '55th Governor of New Jersey and former U.S. Attorney for the District of New Jersey',
      ),
    ).toBe('X (Governor of New Jersey)')
    expect(
      r('educator and First Lady of the United States from 2021 to 2025'),
    ).toBe('X (educator)')
    expect(r('Mexican writer, poet and diplomat (1914–1998)')).toBe(
      'X (writer, poet and diplomat)',
    )
    expect(r('Jewish-American inventor of polio vaccine')).toBe(
      'X (inventor of polio vaccine)',
    )
    expect(r('President of Ireland')).toBe('X (President of Ireland)')
    expect(r('Italian American scholar, teacher and activist')).toBe(
      'X (scholar, teacher and activist)',
    )
    expect(r('the 9th President of Somalia from 2017 to 2022')).toBe(
      'X (President of Somalia)',
    )
    expect(r('member of the United States Senate from Maine (1897–1995)')).toBe(
      'X (member of the United States Senate)',
    )
    expect(r('the')).toBe('X')
    expect(
      r('the 10th and current president of the Federal Republic of Somalia'),
    ).toBe('X (president of the Federal Republic)')
  })
})

describe('cleanNickname / cleanMascot', () => {
  it('keeps one short team name and at most two mascots, no parentheticals', () => {
    expect(
      cleanNickname('Penn State: Nittany Lions, Lady Lions, Behrend Lions'),
    ).toBe('Nittany Lions')
    expect(cleanNickname('Bulldogs and Lady Bulldogs')).toBe('Bulldogs')
    expect(cleanNickname('Red Raiders')).toBe('Red Raiders')
    expect(cleanNickname('')).toBe('')
    expect(
      cleanMascot(
        'Judge Indy and Judge Belle (live bears), Bruiser and Marigold (costumed)',
      ),
    ).toBe('Judge Indy and Judge Belle, Bruiser and Marigold')
    expect(cleanMascot('Antioch Free Radicals (historical)')).toBe(
      'Antioch Free Radicals',
    )
    expect(cleanMascot('None')).toBe('')
  })
})

describe('toSchoolFacts', () => {
  it('assembles a row from seed + wikitext + alumni, omitting unknown fields', () => {
    const row = toSchoolFacts(
      { school: 'Texas Tech University', funFact: 'Guns up.' },
      'Texas Tech University',
      INFOBOX,
      ['Gene Kelly (dancer)'],
    )
    expect(row).toEqual({
      school: 'Texas Tech University',
      wikipedia: 'Texas Tech University',
      funFact: 'Guns up.',
      type: 'Public',
      founded: 1923,
      undergrad: 34184,
      postgrad: 8271,
      enrollmentAsOf: 'fall 2025',
      mascot: 'Masked Rider, Raider Red',
      nickname: 'Red Raiders',
      division: 'NCAA Division I FBS',
      conference: 'Big 12',
      ranking: { list: 'National Universities', rank: 186 },
      alumni: ['Gene Kelly (dancer)'],
    })
  })
  it('falls back to the total `students` count when undergrad/postgrad are absent', () => {
    const row = toSchoolFacts(
      { school: 'X', funFact: 'f' },
      'X',
      '{{Infobox university\n| name = X\n| students = 23,150 (fall 2024)<ref>x</ref>\n| affiliations = [[NCAA Division II]] – [[Peach Belt Conference]]\n}}',
      [],
    )
    expect(row.students).toBe(23150)
    expect(row.enrollmentAsOf).toBe('fall 2024')
    expect(row.undergrad).toBeUndefined()
    expect(row.division).toBe('NCAA Division II')
    expect(row.conference).toBe('Peach Belt Conference')
  })
  it('lets the seed override alumni and type, and fills nothing it cannot read', () => {
    const row = toSchoolFacts(
      { school: 'X', funFact: 'f', alumni: ['Someone (poet)'], type: 'Public' },
      'X (university)',
      '{{Infobox university\n| name = X\n}}',
      ['Ignored'],
    )
    expect(row).toEqual({
      school: 'X',
      wikipedia: 'X (university)',
      funFact: 'f',
      type: 'Public',
      alumni: ['Someone (poet)'],
    })
  })
  it('throws when the article has no university infobox', () => {
    expect(() =>
      toSchoolFacts({ school: 'X', funFact: 'f' }, 'X', 'no box', []),
    ).toThrow(/infobox/i)
  })
})

describe('validateSchoolSeed', () => {
  const wanted = ['A University', 'B College']
  it('accepts a complete seed', () => {
    expect(
      validateSchoolSeed(
        [
          {
            school: 'A University',
            funFact: 'A fact that is long enough to count.',
          },
          {
            school: 'B College',
            funFact: 'Another fact that is long enough too.',
          },
        ],
        wanted,
      ),
    ).toEqual([])
  })
  it('flags missing, unknown, duplicate schools and bad fun facts', () => {
    const problems = validateSchoolSeed(
      [
        { school: 'A University', funFact: 'short' },
        {
          school: 'A University',
          funFact: 'Another fact that is long enough too.',
        },
        {
          school: 'Nowhere U',
          funFact: 'Another fact that is long enough too.',
        },
        { school: 'Z', funFact: 'x'.repeat(400), type: 'Charter' },
      ],
      wanted,
    )
    expect(
      problems.some((p) => p.includes('B College') && p.includes('missing')),
    ).toBe(true)
    expect(
      problems.some(
        (p) => p.includes('Nowhere U') && p.includes('not a prompt school'),
      ),
    ).toBe(true)
    expect(problems.some((p) => p.includes('duplicate'))).toBe(true)
    expect(
      problems.some((p) => p.includes('funFact') && p.includes('short')),
    ).toBe(true)
    expect(
      problems.some((p) => p.includes('funFact') && p.includes('long')),
    ).toBe(true)
    expect(problems.some((p) => p.includes('type must be'))).toBe(true)
  })
})

describe('sortFacts', () => {
  it('orders rows by school name for a stable diff', () => {
    expect(
      sortFacts([{ school: 'b' }, { school: 'A' }, { school: 'a' }]).map(
        (r) => r.school,
      ),
    ).toEqual(['A', 'a', 'b'])
  })
})
