-- Reverts everything supabase/seed.sql inserts, so it can be re-run cleanly.
-- Run this BEFORE re-running seed.sql if a previous run partially failed.

-- Cascades away meet_source_files, events, scheduled_heats, scheduled_lanes,
-- physical_heats, physical_heat_sources, physical_lanes (all reference meets.id
-- with "on delete cascade", directly or transitively).
delete from meets where id = '018fc066-a443-5bdc-8773-f3da916e474c';

-- teams/swimmers aren't meet-scoped (ADR-7), so they don't cascade from the delete
-- above — must run AFTER it, once no lane rows still reference them. Keeps the
-- permanent "Aces" team (seeded by migration 20260714000003_seed_team.sql, not
-- by seed.sql) and deletes everything else seed.sql created.
delete from swimmers;
delete from teams where id != '00000000-0000-0000-0000-0000000000a1';
