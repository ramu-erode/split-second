# ADR-10: Physical heats/lanes are auto-materialized at publish

**Status:** Accepted · **Date:** 2026-07-14

## Context

`observations` reference `physical_lane_id`, never `scheduled_lane_id` (ADR-4). That means a heat
nobody ever combines, re-seats, or scratches still needs `physical_heat`/`physical_lane` rows before
a coach can record a time for it — the timing screen and the Order of Events "Upcoming" view both
need a `physical_heat_id` to operate on for *every* heat, not just the ones a Scorer has structurally
edited.

Two ways to get there:
1. **Auto-materialize** one `physical_heat` per `scheduled_heat` (and matching `physical_lanes` per
   `scheduled_lane`, status `seeded`) at the moment a meet is published.
2. **Lazy-create** physical rows the first time a coach opens a given heat on deck.

## Decision

**Auto-materialize at publish.** Publishing a meet copies every `scheduled_heat` into a
`physical_heat` and every `scheduled_lane` into a `physical_lane` (1:1, status `seeded`). Combine,
re-seat, and scratch actions (§7, Scorer/head-coach only) mutate these already-existing rows rather
than being the only path that creates them — a combined heat is just two physical_heats' lanes
reassigned onto one, not a special first-materialization case.

This makes `physical_heats`/`physical_lanes` the single live source of truth the rest of the app
reads from (Upcoming view, timing screen, results) — `scheduled_*` stays purely as the immutable
printed-program reference, never queried directly once a meet is live.

## Consequences

- Publish becomes a heavier write (copies the whole program), but it's a one-time pre-meet action
  with connectivity available (§5.1), so the cost is fine to pay upfront.
- Every screen that shows "what's happening on deck" has one consistent table to query
  (`physical_heats`/`physical_lanes`), with no branch for "hasn't been materialized yet."
- A multi-day meet with many sessions materializes a large number of physical rows at once, most of
  which won't be touched for days — acceptable; these are lightweight rows (no observations yet) and
  Postgres/IndexedDB both handle this scale without issue for a single meet's program size.

## Alternatives considered

- **Lazy-create on first open** — avoids the large upfront write, but every read path (Upcoming view,
  search, timing screen entry) needs a "materialize if missing" check, and combine/re-seat logic
  needs to handle the case where one side of a merge hasn't been materialized yet. More edge cases
  for a save that isn't actually expensive at this data scale.
