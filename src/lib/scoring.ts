/**
 * Distance + scoring for a single round.
 *
 * Scoring is 0–100 per round (a perfect 5-round day = 500):
 *  - within PERFECT_RADIUS_M of the town → 100 ("you were basically there").
 *  - beyond it, an EXPONENTIAL falloff with length scale DECAY_M. Nationwide
 *    guessing needs a curve, not a line: a linear ramp to zero at ~1,000 km
 *    would hand ~60 points to someone a full state away. With the constants
 *    below (25 km / 350 km):
 *
 *        50 km → 93   100 km → 81   200 km → 61   300 km → 46
 *       500 km → 26   800 km → 11  1000 km →  6  1500 km →  1
 *
 *    i.e. right metro = green, right state = yellow/orange, wrong region = black.
 *    Tunable after playtesting — see docs/PLAN.md §Scoring.
 */

import type { Guess, Town } from '../types'

/** Max points for one round. A perfect 5-round day = 500. */
export const MAX_ROUND_SCORE = 100

/** Within this distance of the town's pin, the round scores 100. ~15 miles. */
export const PERFECT_RADIUS_M = 25_000

/** Exponential decay length past the perfect radius. ~217 miles. */
export const DECAY_M = 350_000

const EARTH_RADIUS_M = 6_371_000
const METERS_PER_MILE = 1609.344

/** Great-circle distance in meters between two lat/lng points. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s))
}

/**
 * Map a distance (meters) to an integer score in [0, MAX_ROUND_SCORE]:
 * MAX within PERFECT_RADIUS_M, then exponential decay with scale DECAY_M.
 * Rounds to an integer, so very far guesses (≳1,900 km) land on exactly 0.
 */
export function scoreForDistance(distanceMeters: number): number {
  if (distanceMeters <= PERFECT_RADIUS_M) return MAX_ROUND_SCORE
  const excess = distanceMeters - PERFECT_RADIUS_M
  return Math.round(MAX_ROUND_SCORE * Math.exp(-excess / DECAY_M))
}

/** Score a guess against a town, returning distance + score. */
export function scoreGuess(
  town: Town,
  guess: Guess,
): { distanceMeters: number; score: number } {
  const distanceMeters = haversineMeters(town, guess)
  return { distanceMeters, score: scoreForDistance(distanceMeters) }
}

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE
}

/**
 * Human-friendly distance in miles (this is a US game): one decimal under 10 mi
 * ("3.4 mi"), whole miles otherwise ("142 mi"), thousands separated.
 */
export function formatDistance(meters: number): string {
  const mi = metersToMiles(meters)
  if (mi < 10) return `${mi.toFixed(1)} mi`
  return `${Math.round(mi).toLocaleString('en-US')} mi`
}

/** Emoji tier for a single round score: 🟩≥80 🟨≥50 🟧≥20 ⬛<20. */
export function scoreEmoji(score: number): string {
  if (score >= 80) return '🟩'
  if (score >= 50) return '🟨'
  if (score >= 20) return '🟧'
  return '⬛'
}
