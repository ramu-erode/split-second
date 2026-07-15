-- Same class of bug 20260714000004 already fixed for source_scheduled_lane_id:
-- physical_lanes.event_id had no `on delete` rule (defaulting to NO ACTION), so deleting a meet —
-- which cascades to both `events` (events.meet_id on delete cascade) and, via a separate path, to
-- `physical_lanes` (physical_heats.meet_id on delete cascade -> physical_lanes.physical_heat_id on
-- delete cascade) — can hit the events FK check before the physical_lanes cascade path has removed
-- the referencing rows, since Postgres doesn't order two independent cascade paths from the same
-- delete for you. `on delete cascade` here is correct, not `on delete set null`: a physical_lane's
-- event_id is its scoring category (CLAUDE.md invariant #3) — a lane with that scrubbed to null
-- would be a broken row, not a valid "uncategorized" one, and it's always being deleted alongside
-- its event's own meet anyway.
alter table physical_lanes
  drop constraint physical_lanes_event_id_fkey,
  add constraint physical_lanes_event_id_fkey
    foreign key (event_id) references events (id) on delete cascade;
