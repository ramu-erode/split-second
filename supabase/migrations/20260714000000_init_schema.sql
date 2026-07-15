-- SplitSecond initial schema
-- Mirrors docs/architecture.md §3, incorporating ADR-6 (tie handling), ADR-7 (multi-team
-- modeling), ADR-8 (materialized results), ADR-9 (PDF import provenance), ADR-10 (physical-heat
-- materialization). See docs/adr/ for the reasoning behind each design choice referenced below.

create extension if not exists pgcrypto;

-- Identity -----------------------------------------------------------------

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_my_team boolean not null default false,
  created_at timestamptz not null default now()
);

create table coaches (
  id uuid primary key references auth.users (id) on delete cascade,
  team_id uuid not null references teams (id),
  display_name text not null,
  -- authorization bit for structural edits (combine heats, re-seat, scratches) — see CLAUDE.md
  -- invariant #4 and ADR-10. Distinct from the Timer/Scorer screen toggle, which is client-only UI
  -- state, not a DB column.
  can_score boolean not null default false,
  created_at timestamptz not null default now()
);
create index coaches_team_id_idx on coaches (team_id);

create table swimmers (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id),
  name text not null,
  external_ref text,
  birth_year int,
  gender text,
  created_at timestamptz not null default now()
);
create index swimmers_team_id_idx on swimmers (team_id);

-- Meet & program (immutable after publish) ----------------------------------

create table meets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  venue text,
  start_date date,
  status text not null default 'draft' check (status in ('draft', 'published', 'live', 'done')),
  created_by uuid references coaches (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ADR-9: a meet is assembled from one or more uploaded PDFs, not a single file.
create table meet_source_files (
  id uuid primary key default gen_random_uuid(),
  meet_id uuid not null references meets (id) on delete cascade,
  filename text not null,
  format_detected text, -- e.g. 'hytek-crystal-reports' | 'excel-two-column'; free text, adapters can grow
  day_no int,
  session text, -- e.g. 'morning' | 'evening'; free text, not enumerated
  uploaded_by uuid references coaches (id),
  uploaded_at timestamptz not null default now(),
  status text not null default 'parsed' check (status in ('parsed', 'needs_review', 'merged'))
);
create index meet_source_files_meet_id_idx on meet_source_files (meet_id);

create table points_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table points_rows (
  points_table_id uuid not null references points_tables (id) on delete cascade,
  place int not null check (place > 0),
  points numeric not null,
  primary key (points_table_id, place)
);

-- gender/age_group are free text, not enums: observed vocabularies already differ across sources
-- (Senior: Men/Women/Mixed; age-group: Boys/Girls + "Group I".."Group VIII") — see ADR-9 context.
create table events (
  id uuid primary key default gen_random_uuid(),
  meet_id uuid not null references meets (id) on delete cascade,
  event_no int not null,
  name text not null,
  distance_m int not null,
  stroke text not null,
  gender text not null,
  age_group text,
  is_relay boolean not null default false,
  points_table_id uuid references points_tables (id),
  unique (meet_id, event_no)
);
create index events_meet_id_idx on events (meet_id);

create table scheduled_heats (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  heat_no int not null,
  -- set null (not cascade): this is a provenance link, not core data. It also crosses into a
  -- separate cascade tree hanging off meets (meets -> meet_source_files), so leaving it
  -- unconstrained creates a delete-order hazard when both trees cascade from the same
  -- `delete from meets` — see supabase/reset_seed.sql history for what that looks like in practice.
  source_file_id uuid references meet_source_files (id) on delete set null,
  source_page int,
  unique (event_id, heat_no)
);
create index scheduled_heats_event_id_idx on scheduled_heats (event_id);

create table scheduled_lanes (
  id uuid primary key default gen_random_uuid(),
  scheduled_heat_id uuid not null references scheduled_heats (id) on delete cascade,
  lane_no int not null,
  swimmer_id uuid references swimmers (id),
  team_id uuid references teams (id),
  seed_time_ms int,
  unique (scheduled_heat_id, lane_no)
);
create index scheduled_lanes_heat_id_idx on scheduled_lanes (scheduled_heat_id);
create index scheduled_lanes_swimmer_id_idx on scheduled_lanes (swimmer_id);

-- On-deck reality (ADR-10: auto-materialized 1:1 from scheduled_* at publish time) -------------

create table physical_heats (
  id uuid primary key default gen_random_uuid(),
  meet_id uuid not null references meets (id) on delete cascade,
  label text,
  start_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  created_by uuid references coaches (id),
  updated_at timestamptz not null default now()
);
create index physical_heats_meet_id_idx on physical_heats (meet_id);

create table physical_heat_sources (
  physical_heat_id uuid not null references physical_heats (id) on delete cascade,
  scheduled_heat_id uuid not null references scheduled_heats (id) on delete cascade,
  primary key (physical_heat_id, scheduled_heat_id)
);

create table physical_lanes (
  id uuid primary key default gen_random_uuid(),
  physical_heat_id uuid not null references physical_heats (id) on delete cascade,
  lane_no int not null,
  swimmer_id uuid references swimmers (id), -- null = unidentified deck entry
  team_id uuid references teams (id),
  -- scoring category travels WITH the lane, not the heat (CLAUDE.md invariant #3):
  event_id uuid references events (id),
  gender text,
  age_group text,
  status text not null default 'seeded' check (status in ('seeded', 'scratched', 'no_show', 'deck_entry')),
  -- set null, not cascade — same cross-tree-provenance hazard as scheduled_heats.source_file_id
  -- above (this one crosses into the scheduled_heats/events tree instead of meet_source_files).
  source_scheduled_lane_id uuid references scheduled_lanes (id) on delete set null,
  unique (physical_heat_id, lane_no)
);
create index physical_lanes_event_id_idx on physical_lanes (event_id);
create index physical_lanes_swimmer_id_idx on physical_lanes (swimmer_id);

-- Live timing (append-only — CLAUDE.md invariant #1) -----------------------------------------

create table observations (
  id uuid primary key default gen_random_uuid(), -- client-generated in practice
  physical_lane_id uuid not null references physical_lanes (id) on delete cascade,
  coach_id uuid not null references coaches (id),
  final_time_ms int,
  source text not null check (source in ('stopwatch', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index observations_lane_deleted_idx on observations (physical_lane_id, deleted);
create index observations_coach_id_idx on observations (coach_id);

create table splits (
  id uuid primary key default gen_random_uuid(), -- client-generated in practice
  observation_id uuid not null references observations (id) on delete cascade,
  split_no int not null,
  split_ms int not null,
  unique (observation_id, split_no)
);

-- Scoring (ADR-8: materialized, recomputed on write; ADR-6: ties share a place, full points each) --

create table results (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  place int,
  physical_lane_id uuid not null references physical_lanes (id) on delete cascade,
  time_ms int,
  team_id uuid references teams (id),
  points numeric,
  -- true unless every non-scratched/non-no_show lane across every physical heat sourced from this
  -- event has at least one non-deleted observation — see ADR-8 "Partial timing".
  is_provisional boolean not null default true,
  computed_at timestamptz not null default now(),
  unique (event_id, physical_lane_id)
);
create index results_event_team_idx on results (event_id, team_id);

-- Collaboration ---------------------------------------------------------------------------------

create table activity_log (
  id uuid primary key default gen_random_uuid(),
  meet_id uuid not null references meets (id) on delete cascade,
  coach_id uuid references coaches (id),
  action text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_meet_id_idx on activity_log (meet_id);

create table lane_claims (
  physical_lane_id uuid not null references physical_lanes (id) on delete cascade,
  coach_id uuid not null references coaches (id),
  created_at timestamptz not null default now(),
  primary key (physical_lane_id, coach_id)
);
