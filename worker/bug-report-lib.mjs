/**
 * Pure helpers for the bug-report Worker (ported from KnowYourCity). Kept out
 * of the entry module so it exports only `default`.
 */

/** Neutralize report text so it can't ping users, break out of its block, or
 *  inject a DISGUISED live link/image into the (public) issue: @mentions,
 *  code fences, Markdown link/image syntax (inline + reference) are broken
 *  with a zero-width space; raw HTML is entity-escaped (GitHub's sanitizer
 *  keeps allowed TAGS like <a>/<img>, only stripping unsafe attributes);
 *  issue cross-references (#123 / GH-123) are broken so a report can't spray
 *  backlink notifications. A BARE https://… URL stays visible on purpose so
 *  triagers can read it — only the hidden-destination case is defanged. */
export function defang(s) {
  return String(s)
    .replace(/```/g, '`\u200B`\u200B`')
    .replace(/@/g, '@\u200B')
    .replace(/!\[/g, '!\u200B[')
    .replace(/\]\(/g, ']\u200B(')
    .replace(/\]\[/g, ']\u200B[')
    .replace(/^(\s*\[[^\]]+\]):/gm, '$1\u200B:')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/#(\d)/g, '#\u200B$1')
    .replace(/\bGH-(\d)/g, 'GH-\u200B$1')
    .replace(/\r/g, '')
}

/** True if `url` parses and its origin is EXACTLY one of the allowed origins.
 *  A prefix check would let lookalike hosts through (site.com.evil.com). */
export function urlFromAllowedOrigin(url, origins) {
  try {
    return origins.includes(new URL(url).origin)
  } catch {
    return false
  }
}

/** Issue title from the first line of the message: "[bug] …", ≤ 80 chars,
 *  with backticks, @ and newlines flattened. */
export function issueTitle(message) {
  return (
    '[bug] ' +
    (String(message).split('\n')[0] || '')
      .replace(/[`@\r\n]/g, ' ')
      .slice(0, 80)
      .trim()
  )
}
