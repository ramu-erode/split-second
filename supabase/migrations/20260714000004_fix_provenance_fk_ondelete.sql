-- Fixes the two provenance FKs added in 20260714000000_init_schema.sql that were missing an
-- ON DELETE policy: they cross into a separate cascade tree hanging off meets, so leaving them
-- unconstrained creates a delete-order hazard the moment both trees cascade from the same
-- `delete from meets` (hit in practice: "update or delete on table meet_source_files violates
-- foreign key constraint scheduled_heats_source_file_id_fkey"). Both should SET NULL, not
-- CASCADE — they're traceability links, not core data.

alter table scheduled_heats
  drop constraint scheduled_heats_source_file_id_fkey,
  add constraint scheduled_heats_source_file_id_fkey
    foreign key (source_file_id) references meet_source_files (id) on delete set null;

alter table physical_lanes
  drop constraint physical_lanes_source_scheduled_lane_id_fkey,
  add constraint physical_lanes_source_scheduled_lane_id_fkey
    foreign key (source_scheduled_lane_id) references scheduled_lanes (id) on delete set null;
