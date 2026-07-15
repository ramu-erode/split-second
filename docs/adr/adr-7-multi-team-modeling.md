# ADR-7: Model every team at the meet, not just "my team"

**Status:** Accepted · **Date:** 2026-07-13

## Context

SplitSecond is operated by coaches from one team, but a swim meet's scoring depends on **all**
competitors: top-6 finish times and points span every team in the event, not just the operating
team's swimmers (`SPEC.md` §2, §4). Coaches also confirmed they sometimes record times for
swimmers on other teams — for their own reference, and because those times feed the points
calculation.

The alternative was to only fully model "my team" swimmers and represent opponents loosely (e.g. a
name/team string on `results` rather than a real `swimmers` row).

## Decision

`teams` and `swimmers` hold **real rows for every team and swimmer in the meet's Order of Events**,
not only the operating team's roster. `teams.is_my_team` is the filter flag the UI uses for "my
team" views (upcoming heats, roster review during import), but it does not restrict which teams get
full records.

Consequently:
- `physical_lanes.team_id` and `scheduled_lanes.team_id` can reference any team.
- `observations.coach_id` is independent of `physical_lanes.team_id` — any coach can log an
  observation for any lane, regardless of which team it belongs to.
- The PDF import (pre-meet ingestion, `SPEC.md` §5.1) must parse and create swimmer/team records for
  the whole heat sheet, not just the rows matching the operating team.

## Consequences

- Import parsing and review is more work than "my team only," since every swimmer on the sheet needs
  a row.
- Scoring and leaderboard queries are simpler and correct out of the box — `results` and team-point
  sums don't need a special case for "swimmers we don't have a record for."
- No later migration is needed if the app is ever used to track full-meet standings rather than just
  one team's points.

## Alternatives considered

- **Single-team modeling with string-only opponents** — less import work up front, but would have
  required a schema change the first time someone wanted structured opponent data (e.g. matching
  opponent swimmers across meets, or a coach wanting to look up an opposing swimmer's history).
