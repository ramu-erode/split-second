-- Row-level security. MVP baseline for a single team's coaches operating the app across a whole
-- multi-team meet (ADR-7) — broad read access for any signed-in coach, write gating only where
-- CLAUDE.md's invariants require it (#1 append-only observations, #4 Scorer-only structural edits).
-- Revisit if this ever needs to isolate multiple teams' coaching staffs from each other.

-- Helper functions are SECURITY DEFINER so they can read `coaches` without recursing back through
-- that table's own RLS policies (which themselves call these helpers) — a naive SECURITY INVOKER
-- version here would cause infinite recursion the moment coaches_select evaluates is_coach().
create or replace function is_coach()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from coaches c where c.id = auth.uid());
$$;

create or replace function can_score()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from coaches c where c.id = auth.uid() and c.can_score);
$$;

grant execute on function is_coach() to authenticated;
grant execute on function can_score() to authenticated;

alter table teams enable row level security;
alter table coaches enable row level security;
alter table swimmers enable row level security;
alter table meets enable row level security;
alter table meet_source_files enable row level security;
alter table points_tables enable row level security;
alter table points_rows enable row level security;
alter table events enable row level security;
alter table scheduled_heats enable row level security;
alter table scheduled_lanes enable row level security;
alter table physical_heats enable row level security;
alter table physical_heat_sources enable row level security;
alter table physical_lanes enable row level security;
alter table observations enable row level security;
alter table splits enable row level security;
alter table results enable row level security;
alter table activity_log enable row level security;
alter table lane_claims enable row level security;

-- Read: any signed-in coach can read everything.
create policy teams_select on teams for select using (is_coach());
create policy coaches_select on coaches for select using (is_coach());
create policy swimmers_select on swimmers for select using (is_coach());
create policy meets_select on meets for select using (is_coach());
create policy meet_source_files_select on meet_source_files for select using (is_coach());
create policy points_tables_select on points_tables for select using (is_coach());
create policy points_rows_select on points_rows for select using (is_coach());
create policy events_select on events for select using (is_coach());
create policy scheduled_heats_select on scheduled_heats for select using (is_coach());
create policy scheduled_lanes_select on scheduled_lanes for select using (is_coach());
create policy physical_heats_select on physical_heats for select using (is_coach());
create policy physical_heat_sources_select on physical_heat_sources for select using (is_coach());
create policy physical_lanes_select on physical_lanes for select using (is_coach());
create policy observations_select on observations for select using (is_coach());
create policy splits_select on splits for select using (is_coach());
create policy results_select on results for select using (is_coach());
create policy activity_log_select on activity_log for select using (is_coach());
create policy lane_claims_select on lane_claims for select using (is_coach());

-- Self-provisioning: a signed-in user can create their own coach row, but cannot grant themselves
-- scoring/structural-edit authority — only an existing Scorer/head-coach can promote someone.
create policy coaches_self_insert on coaches for insert
  with check (id = auth.uid() and can_score = false);
create policy coaches_update_by_scorer on coaches for update
  using (can_score()) with check (true);

-- Pre-meet ingestion (import/review/publish): any coach can build/adjust the draft program.
create policy teams_write on teams for insert with check (is_coach());
create policy teams_update on teams for update using (is_coach());
create policy swimmers_write on swimmers for insert with check (is_coach());
create policy swimmers_update on swimmers for update using (is_coach());
create policy meets_write on meets for insert with check (is_coach());
create policy meets_update on meets for update using (is_coach());
create policy meet_source_files_write on meet_source_files for insert with check (is_coach());
create policy meet_source_files_update on meet_source_files for update using (is_coach());
create policy events_write on events for insert with check (is_coach());
create policy events_update on events for update using (is_coach());
create policy scheduled_heats_write on scheduled_heats for insert with check (is_coach());
create policy scheduled_heats_update on scheduled_heats for update using (is_coach());
create policy scheduled_lanes_write on scheduled_lanes for insert with check (is_coach());
create policy scheduled_lanes_update on scheduled_lanes for update using (is_coach());

-- Structural edits on live data are Scorer/head-coach only (CLAUDE.md invariant #4).
create policy physical_heats_write on physical_heats for insert with check (can_score());
create policy physical_heats_update on physical_heats for update using (can_score());
create policy physical_heat_sources_write on physical_heat_sources for insert with check (can_score());
create policy physical_heat_sources_delete on physical_heat_sources for delete using (can_score());
create policy physical_lanes_write on physical_lanes for insert with check (can_score());
create policy physical_lanes_update on physical_lanes for update using (can_score());
create policy activity_log_write on activity_log for insert with check (is_coach());

-- Observations are append-only, per-coach (CLAUDE.md invariant #1): a coach may only write/correct
-- their own observations, never another coach's.
create policy observations_insert on observations for insert
  with check (coach_id = auth.uid());
create policy observations_update on observations for update
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());
create policy splits_write on splits for insert
  with check (exists (
    select 1 from observations o where o.id = observation_id and o.coach_id = auth.uid()
  ));

-- Results are meant to be engine-computed (ADR-8). Until the recompute function/trigger exists,
-- gate manual writes to Scorer/head-coach so the leaderboard isn't open to arbitrary edits.
create policy results_write on results for insert with check (can_score());
create policy results_update on results for update using (can_score());
create policy points_tables_write on points_tables for insert with check (can_score());
create policy points_rows_write on points_rows for insert with check (can_score());

-- Lane claims: soft, self-managed.
create policy lane_claims_write on lane_claims for insert with check (coach_id = auth.uid());
create policy lane_claims_delete on lane_claims for delete using (coach_id = auth.uid());
