/**
 * Minimal typings so src/lib/schoolsFile.test.ts can import the guard
 * helpers from the plain-JS build library. Keep in sync with the exports it
 * uses; everything else stays untyped on purpose (the lib is Node-only).
 */
export const ALUMNI_BLOCKLIST: Set<string>
export const BLOCKED_ROLE: RegExp
export function isBlockedAlumnus(name: string, descr?: string): boolean
