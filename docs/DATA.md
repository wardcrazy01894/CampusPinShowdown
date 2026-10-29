# Town dataset

`public/towns.json` is the game's only data file: every playable college town
with its school(s), state, difficulty tier and a pin. It is **generated** from a
hand-curated seed — never edit it by hand.

```
data/towns-seed.json  ──  npm run build-towns  ──▶  public/towns.json
 (curated: name, state,      (Nominatim geocode,        (sorted by id,
  schools, difficulty)        cached, validated,         4-dp coords)
                              cross-checked against
                              data/census-pins.json)
```

## Seed schema (`data/towns-seed.json`)

```jsonc
{
  "name": "Ann Arbor", // town name as shown to the player
  "stateCode": "MI", // USPS code; the full state name is derived
  "schools": ["University of Michigan"], // the clue; 1+ entries
  "difficulty": "easy", // easy | medium | hard
  "lat": 41.3915, // OPTIONAL manual pin (both or neither) —
  "lng": -73.956, //   overrides geocoding, marks source: "manual"
}
```

`(name, stateCode)` must be unique; the id is `slug(name)-<st>` (e.g.
`st-peter-mn`). The same town name in two states is fine (`athens-ga`,
`athens-oh`).

## Difficulty tiers

Hand-assigned, roughly by how nationally recognisable the town is — it drives the
daily `easy, easy, medium, medium, hard` plan (`docs/PLAN.md`).

| tier   | what goes here                                                                 | today |
| ------ | ------------------------------------------------------------------------------ | ----- |
| easy   | big schools most sports fans can place (Ann Arbor, Austin, Tuscaloosa…)        | 59    |
| medium | known names that are tough to place (Toledo, Davidson, Boise State, Dartmouth) | 75    |
| hard   | small / regional schools (Lehigh, Stetson, Colgate, Gambier, Vermillion…)      | 156   |

**290 towns** total, lower 48 only (the map is locked to `REGION.bounds`;
Alaska/Hawaii are a BACKLOG item). Big cities with a flagship (Austin,
Minneapolis, Seattle) are in as `easy`; cities where the university isn't the
town's identity (Los Angeles, Chicago, Houston) are left out on purpose.

## Geocoding (`scripts/build-towns.mjs`)

- Queries OpenStreetMap **Nominatim** for `"<Town>, <State>, USA"` — free, no
  key. Usage policy honoured: one request per ~1.1 s and an identifying
  `User-Agent`. Responses are cached in `data/.nominatim-cache.json`
  (gitignored), so a rebuild only hits the network for **new** towns.
- The query asks for `featureType=settlement`, `limit=10`, `addressdetails=1`
  (jsonv2). `pickResult` keeps only hits whose `address.state` matches the
  seed **and** whose `addresstype` is a settlement kind, ranked
  **city > town > village > borough > municipality > hamlet > CDP > locality >
  suburb/quarter/neighbourhood**, then by Nominatim `importance`. Counties,
  states and districts are never accepted. This ordering is what stops a
  same-named neighbourhood (Claremont in Berkeley), hamlet (Ada by the Ohio
  River) or county (Hamilton, Gunnison, Kearney) from beating the real town —
  the PR #2 review found eleven such mis-pins under the old "prefer `place`
  over `boundary`, then importance" rule.
- **Independent cross-check:** every geocoded pin must lie within
  **10 km — or 1.5× the place's equivalent radius √(land area/π) for a
  sprawling city** (`censusToleranceKm`; Tucson ≈ 21 km) — of the same place's pin in
  `data/census-pins.json` — the US Census Bureau Gazetteer's internal point for
  that place (public domain). Otherwise `build-towns` fails and names the town.
  The committed `public/towns.json` is checked the same way in CI
  (`src/lib/towns.test.ts`), so a bad rebuild or hand edit can't reach `main`.
- The request has a 15 s timeout and one retry with backoff on network errors,
  HTTP 429 and 5xx. Cache keys carry a `QUERY_VERSION` prefix; bump it when the
  query parameters change so stale answers are never reused.
- A town with no qualifying hit, or a hit outside the lower 48, **fails the
  build** with its id listed. Fix it by adding a manual `lat`/`lng` to the seed
  entry (West Point, NY is the current example — it's a CDP/academy, not a
  settlement in OSM).
- Output coordinates are rounded to 4 dp (~11 m) and rows are sorted by id so a
  rebuild produces a minimal diff.
- Attribution: coordinates are **© OpenStreetMap contributors (ODbL)**; the
  file's `attribution` field carries this and the app footer renders it.

## Census pins (`data/census-pins.json`)

Built once per Gazetteer release by

```bash
node scripts/build-census-pins.mjs <path/to/2024_Gaz_place_national.txt>
```

(download: Census Bureau → Gazetteer Files → Places, national). It matches each
seed town to its Gazetteer place by state + name (handles "Athens-Clarke County
unified government", "Amherst Town city", "Boise City city", campus CDPs such
as "Haverford College CDP"), prefers an incorporated place over a CDP, and
fails loudly on a town with no row. Every seeded town has a pin today (290).
Add a town → add its Census pin by re-running this script.

## Guard test (`src/lib/towns.test.ts`)

Runs in CI against the committed file: envelope, full row shape, unique sorted
ids, every pin inside the region, minimum depth per tier (40/60/80), **every
pin within its size-aware Census tolerance (10 km floor)**, regression spot-checks for the eleven
pins the PR #2 review found wrong, and that every day of the first year selects
a full, five-different-states lineup.

## Adding a town

1. Append to `data/towns-seed.json` (keep the file grouped by tier).
2. Re-run `scripts/build-census-pins.mjs` so the new town has a Census pin
   (the build refuses a town without one).
3. `npm run build-towns` — only the new town is geocoded, and its pin is
   cross-checked. If it fails the 10 km check, add a manual `lat`/`lng`.
4. Update the counts in this file and the README; `npm test` must stay green.
5. Because selection is per-town-ranked (`docs/PLAN.md`), adding a town leaves
   existing days' lineups alone except where the new town out-ranks a pick.
