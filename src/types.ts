/**
 * Core domain types for CampusPin Showdown.
 *
 * These are the shared contracts between the data script, the game logic, and
 * the React components. Keep them stable — changing `Town` means regenerating
 * public/towns.json; changing `PersistedState` means bumping STORAGE_VERSION
 * in src/lib/storage.ts.
 */

/** A single guessable college town. Mirrors one entry in public/towns.json. */
export interface Town {
  /** Stable kebab-case slug, unique nationwide: `<town>-<state code>`, e.g. "ann-arbor-mi". */
  id: string
  /** Town name shown to the player, e.g. "Ann Arbor". */
  name: string
  /** Full state name, e.g. "Michigan". Revealed only AFTER the guess. */
  state: string
  /** Two-letter USPS code, e.g. "MI". */
  stateCode: string
  /** The school(s) that make it a college town, e.g. ["University of Michigan"]. Shown as the clue. */
  schools: string[]
  /**
   * Which school the round asks about, when the default rule in
   * src/lib/schools.ts would pick the wrong one (Memphis: the rule skips
   * "University of Memphis" for containing the town and would ask about
   * Rhodes College — far below the town's easy tier). Must be one of `schools`.
   */
  prompt?: string
  lat: number
  lng: number
  /**
   * Guessing difficulty. Drives the daily 2-easy/2-medium/1-hard plan
   * (src/lib/daily.ts). Hand-curated in data/towns-seed.json — roughly:
   * easy = nationally famous flagship towns, medium = well-known mid-majors and
   * regional schools, hard = small liberal-arts and deep-cut towns.
   */
  difficulty: Difficulty
  /** Provenance of the coordinates. */
  source: 'nominatim' | 'manual'
  /** Per-row attribution string (license obligation for OSM-derived coords). */
  attribution: string
}

/** Guessing difficulty, from easiest (most famous) to hardest (obscure). */
export type Difficulty = 'easy' | 'medium' | 'hard'

/** The full bundled dataset shape (public/towns.json). */
export interface TownsFile {
  version: number
  region: string
  attribution: string
  towns: Town[]
}

/** A player's single guess for one round. */
export interface Guess {
  lat: number
  lng: number
}

/** The scored outcome of one round. */
export interface RoundResult {
  town: Town
  guess: Guess
  /** Great-circle (haversine) distance from the guess to the town, in meters.
   *  The UI shows it in miles via formatDistance. */
  distanceMeters: number
  /** Score for this round, integer 0..MAX_ROUND_SCORE. */
  score: number
}

/** Status of the in-progress daily game. */
export type GamePhase = 'guessing' | 'revealed' | 'finished'

/** Full state of today's game session (also the shape persisted to localStorage). */
export interface GameState {
  /** Date key, "YYYY-MM-DD" — see daily.ts:getDateKey. */
  dateKey: string
  /** The 5 towns selected for today, in play order. */
  towns: Town[]
  /** Index of the current round, 0..towns.length. */
  roundIndex: number
  /** Completed round results so far. */
  results: RoundResult[]
  phase: GamePhase
}

/** Per-day record kept in history for streak calculation. */
export interface DayRecord {
  dateKey: string
  totalScore: number
  /** Per-round facts kept for lifetime stats. `difficulty` (the town's tier)
   *  is stored from PR #14 on; older records lack it and are skipped by
   *  src/lib/stats.ts. */
  results: Array<
    Pick<RoundResult, 'distanceMeters' | 'score'> & { difficulty?: Difficulty }
  >
  /**
   * Hash of the lineup that was played (see progress.ts:lineupHash). Identifies
   * the completion so a replay against a CHANGED official set is recorded
   * separately from the first play. Optional: records written before this field
   * existed simply lack it.
   */
  lineup?: string
}
