import { describe, it, expect } from 'vitest'
import { defang, urlFromAllowedOrigin, issueTitle } from './bug-report-lib.mjs'

/** Pure abuse mitigations of the bug-report Worker; the request path is in
 *  bug-report.handler.test.mjs. */

describe('defang', () => {
  it('inserts a real U+200B (positive check — not.toMatch alone would pass on junk)', () => {
    expect(defang('@a')).toBe('@\u200Ba')
    expect(defang('```')).toBe('`\u200B`\u200B`')
    expect(defang('[t](u)')).toBe('[t]\u200B(u)')
    expect(defang('#1')).toBe('#\u200B1')
  })

  it('breaks code fences and @mentions, strips CRs', () => {
    expect(defang('```js\nalert(1)\n```')).not.toContain('```')
    expect(defang('cc @maintainer')).not.toMatch(/(^|[^\u200B])@[a-z]/i)
    expect(defang('a\r\nb')).toBe('a\nb')
  })

  it('neutralizes inline + reference links and images, keeping the text readable', () => {
    const out = defang('[click here](https://evil.example/phish)')
    expect(out).not.toMatch(/\]\(/)
    expect(out).toContain('click here')
    expect(out).toContain('evil.example')
    expect(defang('![x](https://evil.example/track.png)')).not.toMatch(/!\[/)
    const ref = defang('[click here][1]\n\n[1]: https://evil.example/phish')
    expect(ref).not.toMatch(/\]\[/)
    expect(ref).not.toMatch(/^\s*\[[^\]]+\]:/m)
  })

  it('escapes raw HTML so <a>/<img> cannot render live', () => {
    const out = defang('<a href="https://evil.example/login">Verify</a>')
    expect(out).not.toMatch(/<a\s/i)
    expect(out).toContain('Verify')
    expect(defang('<img src="https://evil.example/b.png">')).not.toMatch(
      /<img/i,
    )
  })

  it('neutralizes issue cross-references (no backlink spam)', () => {
    const out = defang('see #123 and GH-45')
    expect(out).not.toMatch(/#\d/)
    expect(out).not.toMatch(/\bGH-\d/)
    expect(out).toContain('123')
  })

  it('coerces non-strings without throwing', () => {
    expect(() => defang(null)).not.toThrow()
  })
})

describe('urlFromAllowedOrigin', () => {
  const origins = ['https://campuspinshowdown.com']
  it('accepts an exact-origin URL and rejects lookalikes and junk', () => {
    expect(
      urlFromAllowedOrigin('https://campuspinshowdown.com/?date=x', origins),
    ).toBe(true)
    expect(
      urlFromAllowedOrigin('https://campuspinshowdown.com.evil.com/', origins),
    ).toBe(false)
    expect(urlFromAllowedOrigin('not a url', origins)).toBe(false)
  })
})

describe('issueTitle', () => {
  it('uses the first line, flattens backticks/@/newlines, caps at 80', () => {
    expect(issueTitle('map `broke` @me\nmore')).toBe('[bug] map  broke   me')
    expect(issueTitle('x'.repeat(200)).length).toBe('[bug] '.length + 80)
  })
})
