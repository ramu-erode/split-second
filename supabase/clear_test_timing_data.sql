-- Production readiness: wipe test *timing* data coaches entered while trying out the app,
-- without touching the meet's schedule OR its on-deck structure.
--
-- IMPORTANT: physical_heats / physical_heat_sources / physical_lanes are NOT test data —
-- meet_2026_group1-4_seed.sql and meet_2026_group5-8_seed.sql insert them directly
-- (ADR-10: physical_* is auto-materialized 1:1 from scheduled_* at publish time). Coaches
-- confirmed they only entered/edited times during testing, no structural edits (combine
-- heats / re-seat / scratch), so physical_heats and physical_lanes should still match the
-- seed files exactly — do not delete or reset them here.
--
-- What actually is test data: observations (+ splits, which cascade from them), results
-- (materialized/recomputed per ADR-8 — safe to wipe, they'll rebuild from new observations),
-- and lane_claims (ephemeral claim locks; table isn't wired up in the app yet, so this is
-- likely a no-op, included for completeness).
--
-- physical_heats.status is a separate wrinkle: the app auto-transitions it ('pending' ->
-- 'in_progress' -> 'completed') as observations come in (MeetDataStore.autoUpdateHeatStatus),
-- and deleting observations does NOT roll that back — it's just a column on the untouched
-- physical_heats row. Since neither real meet has actually started yet, every heat's status
-- should currently read 'pending'; STEP 2 resets any that testing bumped forward.
--
-- Scope: only the two real meets loaded via meet_2026_group1-4_seed.sql and
-- meet_2026_group5-8_seed.sql. Run STEP 0 diagnostics first and eyeball the output before
-- running the deletes in STEP 2 — this is irreversible.

-- STEP 0: sanity check — see every meet currently in the DB. Confirm there are no other
-- meets beyond the two below (e.g. a leftover supabase/seed.sql dev fixture).
select id, name, status, start_date from meets order by start_date;

-- STEP 1: how much test-timing data exists per meet right now, so you know what STEP 2
-- removes. Also surfaces activity_log rows for these meets — those only get written by
-- Scorer force-complete/reopen actions (a structural edit), which you said didn't happen;
-- if this count is nonzero, stop and double check before assuming STEP 2's scope is enough.
select
  m.id as meet_id,
  m.name,
  count(distinct o.id) as observations,
  count(distinct r.id) as results,
  count(distinct al.id) as activity_log_rows,
  count(distinct ph.id) filter (where ph.status <> 'pending') as non_pending_heats
from meets m
left join events e on e.meet_id = m.id
left join physical_heats ph on ph.meet_id = m.id
left join physical_lanes pl on pl.physical_heat_id = ph.id
left join observations o on o.physical_lane_id = pl.id
left join results r on r.event_id = e.id
left join activity_log al on al.meet_id = m.id
group by m.id, m.name
order by m.name;

-- STEP 2: the actual delete, scoped to the two real meets. physical_heats/physical_lanes
-- (the seeded on-deck structure) are untouched.
delete from observations
where physical_lane_id in (
  select pl.id
  from physical_lanes pl
  join physical_heats ph on ph.id = pl.physical_heat_id
  where ph.meet_id in (
    '6a302978-5477-5a1e-a33e-12a5617454d3', -- Age Group 1 to 4
    '008ab07f-cf91-5369-9893-c59ad32a37a2'  -- Age Group 5 to 8
  )
);
-- splits cascade away automatically (splits.observation_id ... on delete cascade).

delete from results
where event_id in (
  select id from events
  where meet_id in (
    '6a302978-5477-5a1e-a33e-12a5617454d3',
    '008ab07f-cf91-5369-9893-c59ad32a37a2'
  )
);

delete from lane_claims
where physical_lane_id in (
  select pl.id
  from physical_lanes pl
  join physical_heats ph on ph.id = pl.physical_heat_id
  where ph.meet_id in (
    '6a302978-5477-5a1e-a33e-12a5617454d3',
    '008ab07f-cf91-5369-9893-c59ad32a37a2'
  )
);

-- Roll back the auto-transitioned heat status (see the note near the top) now that the
-- observations driving it are gone. Only touches status — label/start_at/created_by are
-- untouched, and this does NOT delete or reset physical_lanes.status (seeded/scratched/
-- no_show/deck_entry), which is unrelated to timing progress.
update physical_heats
set status = 'pending'
where meet_id in (
  '6a302978-5477-5a1e-a33e-12a5617454d3',
  '008ab07f-cf91-5369-9893-c59ad32a37a2'
)
and status <> 'pending';

-- STEP 3: re-run STEP 1's query to confirm observations/results/non_pending_heats are all
-- zero for these two meets, and that physical_heats/physical_lanes row counts (not shown
-- above — check separately if you want) are unchanged from what the seed files inserted.
-- Then hit Hard Refresh again in the app (More tab) to pull the corrected status down —
-- fullResyncLiveData covers observations/splits, but heat status comes from syncProgramData's
-- wholesale physical_heats refetch, which hardRefresh already runs first.
