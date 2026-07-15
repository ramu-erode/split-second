# ADR-8: `results` is a materialized table, not a live view

**Status:** Accepted · **Date:** 2026-07-13

## Context

The leaderboard (`SPEC.md` §5.2, §9) needs to show live per-team point totals as observations come
in, and the app is offline-first (`CLAUDE.md` invariant #5, `architecture.md` §4): nothing in the
deck flow may hard-depend on a live network call or a live database round-trip.

Two options for where ranking/points live:
1. A Postgres view/function computed on read.
2. A stored `results` table, recomputed whenever a relevant observation or points table changes,
   mirrored by a local TS calculator in IndexedDB.

## Decision

`results` is a **materialized table**: `(event_id, place, physical_lane_id, time_ms, team_id,
points, computed_at, is_provisional)`, recomputed (fully or incrementally) on the write path
whenever an `observation` affecting an event's ranking lands, or a `points_table`/`points_rows`
change applies.

The same ranking/points logic is implemented twice on purpose: once as the Postgres source of truth,
once as a local TypeScript calculator over IndexedDB — per `architecture.md` §5, which already
specified this dual implementation.

### Partial timing

Coaches routinely time only 1–2 lanes of a heat and move on to the next one — `observations` never
requires a full heat before accepting a write (each observation is keyed to one `physical_lane_id`
independently). Since scoring ranks *across all heats of an event*, this means a `results` row can
legitimately be computed from a subset of an event's lanes, and can change later — including
lowering a team's already-shown points if a later-timed swimmer from another heat displaces one
already ranked in the top 6.

Every recompute sets `is_provisional = true` unless every non-scratched/non-no_show
`physical_lane` across every `physical_heat` sourced from that event has at least one non-deleted
observation. Lanes with zero observations are excluded from ranking entirely — they are not treated
as DNS/last-place, since "not yet timed" and "confirmed absent" are different states (the latter is
what `physical_lanes.status = scratched | no_show` is for).

The leaderboard UI must surface `is_provisional` (badge, muted styling, etc.) so a partial standing
is never presented as final.

## Consequences

- The leaderboard reads a plain table both online and offline — no SQL view logic needs to be
  ported to the client, only the calculator logic (which was already planned).
- Writes are more work: every observation write that could change an event's ranking needs to
  trigger a recompute (of at least that event's results), rather than ranking being free at read
  time.
- `results` needs to tolerate being recomputed repeatedly without duplicating rows — enforced by
  `unique(event_id, physical_lane_id)` plus upsert-on-recompute.
- The two implementations (SQL + TS) can drift; they must be kept in lockstep as scoring rules
  change (e.g. relay points, tie-place-numbering convention once decided).
- Recompute must check completeness across *every* physical heat sourced from the event (not just
  the heat that just got a new observation) to set `is_provisional` correctly — a narrow per-heat
  recompute would miss that other heats in the same event are still untimed.

## Alternatives considered

- **Pure view/function, no stored table** — simpler write path, no recompute logic, but doesn't work
  offline without re-implementing the full view logic client-side anyway (which `architecture.md` §5
  already called for), so it wouldn't have actually avoided the dual-implementation cost — it would
  just have made the online path inconsistent with the offline path.
