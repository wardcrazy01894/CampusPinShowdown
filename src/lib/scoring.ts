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
import { puzzleNumber } from './daily'

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
/**
 * Points deducted from a round when the player revealed the region first
 * (src/lib/hintRegions.ts: a group of 3–6 neighbouring states, never the one
 * state). It narrows the search from a continent to a corner of it, so a
 * hinted perfect pin tops out at 75 — a good round, never a green one.
 */
export const HINT_PENALTY = 25

/** The round score after an optional hint penalty, floored at 0. Pure. */
export function applyHintPenalty(score: number, hinted: boolean): number {
  return hinted ? Math.max(0, score - HINT_PENALTY) : score
}

export function scoreGuess(
  town: Town,
  guess: Guess,
  opts: { hinted?: boolean } = {},
): { distanceMeters: number; score: number } {
  const distanceMeters = haversineMeters(town, guess)
  return {
    distanceMeters,
    score: applyHintPenalty(scoreForDistance(distanceMeters), !!opts.hinted),
  }
}

/** Sum of round scores — the day's total. */
export function totalScore(results: ReadonlyArray<{ score: number }>): number {
  return results.reduce((sum, r) => sum + r.score, 0)
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

/**
 * The emoji for a PERFECT round (100), which rotates daily so a share card
 * with a 100 in it stands out from an ordinary green — and everyone's card
 * agrees on the day's emoji. Indexed by puzzle number: #1 💯, #2 🏆, #3 〽️
 * (the Michigan one), #4 🎯, #5 ⭐, #6 🥇, then round again.
 */
export const PERFECT_EMOJIS = ['💯', '🏆', '〽️', '🎯', '⭐', '🥇'] as const

export function perfectEmoji(dateKey: string): string {
  const n = puzzleNumber(dateKey)
  const len = PERFECT_EMOJIS.length
  // An invalid date key would make n NaN → index NaN; fall back to plain green.
  return PERFECT_EMOJIS[(((n - 1) % len) + len) % len] ?? '🟩'
}

/**
 * Score → tier emoji for the share bar and results rows. With a `dateKey`, a
 * perfect 100 gets that day's special emoji instead of plain green; without
 * one (legacy callers), 100 is just a 🟩.
 */
export function scoreEmoji(score: number, dateKey?: string): string {
  if (score >= MAX_ROUND_SCORE && dateKey) return perfectEmoji(dateKey)
  if (score >= 80) return '🟩'
  if (score >= 50) return '🟨'
  if (score >= 20) return '🟧'
  return '⬛'
}
