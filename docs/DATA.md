# Town dataset

`public/towns.json` is the game's only data file: every playable college town
with its school(s), state, difficulty tier and a pin. It is **generated** from a
hand-curated seed — never edit it by hand.

```
data/towns-seed.json  ──  npm run build-towns  ──▶  public/towns.json
 (curated: name, state,      (Nominatim geocode,        (sorted by id,
  schools, difficulty)        cached, validated)         4-dp coords)
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

| tier   | what goes here                                                                | today |
| ------ | ----------------------------------------------------------------------------- | ----- |
| easy   | flagship / Power-conference towns most sports fans can place (Ann Arbor…)     | 59    |
| medium | well-known mid-majors, regionals, famous small-town Ivies/LACs (Hanover…)     | 91    |
| hard   | small liberal-arts and deep-cut regional towns (Gambier, Vermillion, Ada OK…) | 140   |

**290 towns** total, lower 48 only (the map is locked to `REGION.bounds`;
Alaska/Hawaii are a BACKLOG item). Big cities with a flagship (Austin,
Minneapolis, Seattle) are in as `easy`; cities where the university isn't the
town's identity (Los Angeles, Chicago, Houston) are left out on purpose.

## Geocoding (`scripts/build-towns.mjs`)

- Queries OpenStreetMap **Nominatim** for `"<Town>, <State>, USA"` — free, no
  key. Usage policy honoured: one request per ~1.1 s and an identifying
  `User-Agent`. Responses are cached in `data/.nominatim-cache.json`
  (gitignored), so a rebuild only hits the network for **new** towns.
- `pickResult` accepts only a settlement-type hit (`place`/`boundary` of a
  city/town/village/CDP…) whose `address.state` matches the seed, preferring
  `place` over `boundary` and then Nominatim's `importance`. University
  buildings and counties are rejected.
- A town with no qualifying hit, or a hit outside the lower 48, **fails the
  build** with its id listed. Fix it by adding a manual `lat`/`lng` to the seed
  entry (West Point, NY is the current example — it's a CDP/academy, not a
  settlement in OSM).
- Output coordinates are rounded to 4 dp (~11 m) and rows are sorted by id so a
  rebuild produces a minimal diff.
- Attribution: coordinates are **© OpenStreetMap contributors (ODbL)**; the
  file's `attribution` field carries this and the app footer renders it.

## Guard test (`src/lib/towns.test.ts`)

Runs in CI against the committed file: envelope, full row shape, unique sorted
ids, every pin inside the region, minimum depth per tier (40/60/80), spot-checks
of a few well-known pins (catches the geocoder picking a same-named place in the
wrong spot), and that every day of the first year selects a full,
five-different-states lineup.

## Adding a town

1. Append to `data/towns-seed.json` (keep the file grouped by tier).
2. `npm run build-towns` — only the new town is geocoded.
3. Eyeball its pin in `public/towns.json` (or `?shuffle` in the dev server
   until it comes up); add a manual `lat`/`lng` if Nominatim picked wrong.
4. Update the counts in this file and the README; `npm test` must stay green.
5. Because selection is per-town-ranked (`docs/PLAN.md`), adding a town leaves
   existing days' lineups alone except where the new town out-ranks a pick.
