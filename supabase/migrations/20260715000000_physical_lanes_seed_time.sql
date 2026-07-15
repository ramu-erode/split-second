-- physical_lanes is the only table the live app reads once a meet is published (ADR-10), but it
-- never carried seed_time_ms — only the immutable scheduled_lanes did. That made a swimmer's entry
-- time unavailable anywhere in the deck flow. Denormalize it onto physical_lanes at materialization
-- time (same as every other scheduled_lanes -> physical_lanes copy) so the timing/leaderboard
-- screens can eventually compare an observed time against seed without joining back to
-- scheduled_lanes.
alter table physical_lanes add column seed_time_ms int;
