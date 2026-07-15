# ADR-6: Tie handling — shared place, full points to each

**Status:** Accepted · **Date:** 2026-07-13

## Context

Scoring is by place (1st=7, 2nd=5, 3rd=4, 4th=3, 5th=2, 6th=1; see `SPEC.md` §2). Two or more
swimmers can post the same `time_ms` in an event. `results.place` and `results.points` need a
defined rule so the scoring engine and the `results` table stay consistent.

## Decision

Tied lanes **share the same `place`**, and **each tied lane receives full points** for that place —
points are not split or averaged across the tied swimmers.

Example: two swimmers tie for 2nd. Both get `place = 2` and both get the full 2nd-place points (5),
not 2.5 each.

## Consequences

- `results.points` can stay a plain per-place value pulled from `points_rows` — no fractional-split
  logic needed in the scoring engine.
- Team point totals are **not zero-sum against the point table** when ties occur — a tie can award
  more total points across the field than an untied result would. Accepted as correct per this
  ruling.
- **Still open:** whether the placing *after* a tie skips ahead (two swimmers tie for 2nd → next
  swimmer is 4th) or stays dense (next swimmer is 3rd). This affects which `points_rows.place` the
  next swimmer reads from, but not the schema — tracked in `architecture.md` §10 pending Ramu's
  confirmation of the meet's actual convention.

## Alternatives considered

- **Split points evenly among tied swimmers** — more common in some scoring systems, but rejected;
  Ramu confirmed full points to each tied swimmer for this app.
- **Defer the rule, model `time_ms` only** — kept the schema unblocked but pushed a real product
  decision (and a later migration) downstream for no benefit once the rule was confirmed.
