/**
 * Easter eggs — tiny, deliberate flourishes keyed on specific towns. Pure so
 * they're unit-tested and the components stay thin.
 *
 * 〽️ The first one is a nod to the author's home: Ann Arbor's reveal gets a
 * "Go Blue!". It shows only AFTER the guess is submitted, so it can never be a
 * hint, and only for Ann Arbor — East Lansing would rightly object.
 */

import type { Town } from '../types'

/** Short tag to show next to a town's reveal, or null for no egg. */
export function revealTag(town: Pick<Town, 'id'>): string | null {
  if (town.id === 'ann-arbor-mi') return '〽️ Go Blue!'
  return null
}
