# SplitSecond — Architecture

**Status:** Draft v0.1 · **Last updated:** 2026-07-13

Companion to `SPEC.md`. This document covers the technical design: stack rationale, data model,
sync/offline strategy, scoring engine, and screen/module structure.

---

## 1. Stack & rationale

- **Angular** — leverages existing expertise; strong structure for a data-heavy app.
- **Ionic** — cross-platform component library; native feel, large tap targets for deck use.
- **PWA delivery** — no Apple developer account, no app-store review; distributed as a URL and
  installed via "Add to Home Screen." Instant updates.
- **Capacitor (kept, unused initially)** — wraps the same codebase into native iOS/Android later
  with no rewrite. No lock-in.
- **Supabase** — Postgres (relational model fits events/heats/lanes/observations and scoring SQL),
  plus Realtime (websocket sync) and Auth. Preferred over Firestore because the scoring/ranking math
  is natural in SQL and clunky in a document DB.
- **Offline** — service worker (app shell) + IndexedDB (data). The app must be fully functional with
  zero connectivity on the pool deck.

## 2. High-level architecture

```
┌─────────────────────────────────────────────┐
│  Coach device (PWA: Angular + Ionic)         │
│                                              │
│  UI screens ── local store (IndexedDB) ──┐   │
│                  ▲   append-only          │   │
│                  │   observations         │   │
│              sync engine  ────────────────┼───┼──► Supabase
│                                           │   │     • Postgres (tables)
│  service worker (offline app shell)       │   │     • Realtime (broadcast)
└───────────────────────────────────────────┘   │     • Auth
                                                 │
     other coach devices  ◄──── realtime ────────┘
```

- Reads and writes hit the **local store first** (offline-first).
- The **sync engine** pushes local observations up and pulls remote changes when online.
- Supabase **Realtime** broadcasts changes so co-located coaches converge quickly.

## 3. Data model (Postgres)

Names/columns are indicative; refine during build. Types noted where non-obvious; all `id` columns
are `uuid`, timestamps are `timestamptz`.

```
-- Identity ---------------------------------------------------------
teams        (id, name, is_my_team bool, created_at)

coaches      (id references auth.users, team_id references teams,   -- coach's home team
              display_name,
              can_score bool,             -- authorization for structural edits (Scorer/head-coach);
                                           -- Timer/Scorer screen toggle itself is client-only UI state
              created_at)

swimmers     (id, team_id references teams, name, external_ref,     -- external_ref = PDF import key
              birth_year, gender, created_at)
              -- every team at the meet gets real swimmer rows, not just "my team" — coaches may
              -- log times for opposing swimmers too (reference + points capture)

-- Meet & program (immutable after publish) --------------------------
meets        (id, name, venue, start_date, status,                  -- status: draft | published | live | done
              created_by references coaches, created_at, updated_at)

meet_source_files (id, meet_id, filename, format_detected,          -- 'hytek-crystal-reports' | 'excel-two-column' | ...
                   day_no, session,                                 -- session: morning | evening | ... (one file per day/session is common)
                   uploaded_by references coaches, uploaded_at,
                   status)                                          -- parsed | needs_review | merged

points_tables (id, name)                                            -- individual, relay, etc.
points_rows   (points_table_id, place, points numeric,              -- e.g. (1,7)(2,5)(3,4)(4,3)(5,2)(6,1)
               pk(points_table_id, place))

events       (id, meet_id, event_no, name, distance_m, stroke,
              gender, age_group, is_relay bool, points_table_id,
              unique(meet_id, event_no))

scheduled_heats (id, event_id, heat_no,                             -- from the PDF, immutable after publish
                 source_file_id nullable references meet_source_files,
                 source_page int nullable,                          -- provenance for parse-review UI
                 unique(event_id, heat_no))

scheduled_lanes (id, scheduled_heat_id, lane_no, swimmer_id nullable,
                 team_id, seed_time_ms,
                 unique(scheduled_heat_id, lane_no))

-- On-deck reality ----------------------------------------------------
-- auto-materialized 1:1 from scheduled_heats/scheduled_lanes at publish time (ADR-10); the rest of
-- the app reads only from here once a meet is live, never from scheduled_* directly.
physical_heats  (id, meet_id, label, start_at, status,
                 created_by references coaches, updated_at)         -- one start / one gun

physical_heat_sources (physical_heat_id, scheduled_heat_id,         -- many-to-one: combined heats
                        pk(both))

physical_lanes  (id, physical_heat_id, lane_no,
                 swimmer_id nullable,                                -- null = unidentified deck entry
                 team_id,
                 -- scoring category travels WITH the lane, not the heat:
                 event_id, gender, age_group,
                 status,                                             -- seeded | scratched | no_show | deck_entry
                 source_scheduled_lane_id nullable,                  -- traceability back to the sheet
                 unique(physical_heat_id, lane_no))

-- Live timing (append-only) -------------------------------------------
observations (id UUID pk,                                            -- client-generated
              physical_lane_id, coach_id,
              final_time_ms, source,                                 -- source: stopwatch | manual
              created_at, updated_at, deleted bool)
splits       (id UUID pk, observation_id, split_no, split_ms,        -- client-generated
              unique(observation_id, split_no))

-- Scoring ---------------------------------------------------------------
results       (id, event_id, place, physical_lane_id, time_ms,
               team_id, points numeric, computed_at,                 -- materialized, recomputed on write
               is_provisional bool,                                  -- true while any non-scratched
                                                                       -- lane in the event lacks a time
               unique(event_id, physical_lane_id))

-- Collaboration ------------------------------------------------------
activity_log  (id, meet_id, coach_id, action, payload jsonb, created_at)
lane_claims   (physical_lane_id, coach_id, created_at, pk(both))     -- soft "I've got this lane"
```

Key modeling points:
- **Scheduled vs physical** heats are separate tables. Scheduled data is immutable after publish;
  physical data is what changes live.
- **Category lives on `physical_lanes`** (event_id / gender / age_group), so a mixed-category or
  combined heat still scores each swimmer against the right event.
- **`observations` are append-only**, keyed by client UUID, so offline devices generate IDs safely
  and sync never produces write-write conflicts. Corrections set `updated_at` / `deleted` rather than
  hard-deleting. `observations.coach_id` and `physical_lanes.team_id` are intentionally independent —
  a coach may record a time for any team's lane (reference times, or capturing top-6 for points), not
  only their own team's swimmers. See [ADR-7](adr/adr-7-multi-team-modeling.md).
- **`points_table_id` per event** makes relay vs individual scoring a data/config concern, not code.
- **`results` is a materialized table**, recomputed whenever the observations or points table it
  depends on change (not a live view) — see §5 and [ADR-8](adr/adr-8-materialized-results.md).
- **Partial timing is normal, not an error.** Coaches routinely time 1–2 lanes of a heat and move on;
  `observations` never requires a full heat before it accepts a write. Consequence: `results` for an
  event can be computed from a subset of its lanes, and `is_provisional` marks that state so the
  leaderboard doesn't present an incomplete ranking as final — see ADR-8 §"Partial timing."
- **Ties share a `place` and each tied lane gets full points** for that place (no splitting) — see
  [ADR-6](adr/adr-6-tie-handling.md). Whether the *next* place number skips ahead (1,2,2,4) or stays
  dense (1,2,2,3) is scoring-engine logic, not a schema concern, and is still open (§10).
- **`coaches.can_score`** is the authorization bit RLS checks for structural edits (combine heats,
  re-seat lanes, scratches); it is distinct from the Timer/Scorer screen toggle, which is local UI
  state per §7.
- **A meet is assembled from one or more uploaded PDFs** (`meet_source_files`), not a single file —
  real meets arrive as one PDF per day/session, sometimes in different generator formats. Merge key
  across files is the printed `event_no` — confirmed meet-wide and stable across session files (two
  session files from the same 2025 meet: events 1–26 and 79–104, contiguous, non-overlapping) — with
  `(distance_m, stroke, gender, age_group, is_relay)` as a secondary consistency check, not the
  primary key. See [ADR-9](adr/adr-9-pdf-import-adapters.md).

Suggested indexes: `physical_lanes(event_id)` (scoring ranks per event across all physical lanes),
`observations(physical_lane_id, deleted)` (timing-screen hot path), `results(event_id, team_id)`
(leaderboard sum-by-team).

## 4. Sync & offline strategy

**Two write classes:**

1. **Observations (append-only).** UUID per record, `coach_id` stamped. Merge rule: union of all
   observations; corrections are last-write-wins *per observation id* using `updated_at`. No
   cross-record conflicts because coaches write distinct rows. This is effectively CRDT-lite.

2. **Structural edits (shared state):** combine heats, re-seat lanes, mark scratches. Only the
   **Scorer/head-coach role** may issue these. They are recorded in `activity_log` and applied with
   last-write-wins on the affected `physical_heat` / `physical_lane`, keyed by `updated_at`. UI shows
   who changed what.

**Offline:** all reads/writes go to IndexedDB first. A sync queue flushes to Supabase when online;
Realtime subscriptions pull remote changes. Because the meet is loaded ~2 days ahead and synced while
online, a device can operate an entire session with no connectivity and reconcile afterward.

**iOS PWA note:** iOS may evict IndexedDB after ~7 idle days. Mitigation: cloud is source of truth;
coaches must open the app once online before the meet to repopulate. Surface a "last synced" banner.

**Possible later addition:** local/LAN peer sync (WebRTC/Bonjour-style) for co-located coaches when
the venue has no usable internet. Deferred until proven necessary.

## 5. Scoring engine

- Ranking runs **per event, across all physical lanes of that event's category that have a time**,
  ordered by `time_ms` ascending. Lanes with no non-deleted observation yet are simply excluded from
  the ranking (see "Partial timing" below) — not treated as DNS. Ties share a place and each tied
  lane gets full points, no split (ADR-6).
- The chosen `time_ms` for a lane is derived from its observations (default: prefer a `manual`/
  official time; else average of stopwatch observations — configurable in the reconciliation step).
- Points come from the event's `points_table` (individual = 7/5/4/3/2/1 over 6 places; relay TBD).
- `results` is recomputed (or incrementally updated) as observations land; the leaderboard sums
  `points` by `team_id` for a **running team total**.
- **Partial timing:** because scoring ranks *across all heats of an event*, a result computed while
  any heat is still untimed can change once more lanes get times — including retroactively lowering
  a team's points if a later-timed swimmer displaces one already in the top 6. Every recompute for
  an event sets `results.is_provisional = true` unless every non-scratched/non-no_show lane across
  every physical heat sourced from that event has at least one non-deleted observation. The
  leaderboard UI must surface `is_provisional` (e.g. a badge) rather than presenting an incomplete
  ranking as settled. See ADR-8.
- Implemented as a Postgres view/function for correctness, mirrored by a local TS calculator so the
  leaderboard works offline.

## 6. App structure (Angular / Ionic)

Feature modules (lazy-loaded):

- `meet-import/` — repeatable PDF upload (one draft meet accepts several files, typically one per
  day/session), format-adapter parse, review/correct/merge-conflict resolution, publish. (Primarily
  used on web pre-meet.) See [ADR-9](adr/adr-9-pdf-import-adapters.md) for the format-adapter and
  multi-file-merge design.
- `order-of-events/` — two views: **Upcoming** (default — physical_heats not yet completed, ordered
  by event_no/heat_no, split into "your team is up" vs "coming up," windowed to the next N heats
  rather than the whole remaining day) and **Full Program** (browse all events/heats/lanes,
  collapsible by event, with a "my team" filter and swimmer/team search). Reads only from
  `physical_heats`/`physical_lanes` (ADR-10), entirely from local IndexedDB.
- `timing/` — the core deck screen: stopwatch, split buttons, manual keypad, per-lane observations.
- `heats/` — combine heats, re-seat lanes (drag/tap), scratches, lane claims.
- `scoring/` — top-6 capture, leaderboard, per-event results.
- `sync/` — offline queue, Realtime subscriptions, conflict/merge rules.
- `core/` — auth, roles, models, local store (IndexedDB) adapter.

**Design source:** Google Stitch drafts the 4 core screens (Import, Order of Events, Timing,
Leaderboard) and exports Angular/Tailwind as a *styling reference*; the interactive versions are
rebuilt with Ionic components. Priority design effort goes to the **timing screen** (used under time
pressure).

## 7. Auth

Supabase Auth (email/OTP or magic link). Coaches belong to a team; role (Timer/Scorer) is per-device
and switchable. Row-level security scopes writes to the coach's meet/team.

## 8. Deployment

- Static PWA build hosted on any CDN/static host (e.g. Supabase hosting, Vercel, Netlify, Cloudflare
  Pages). Supabase provides the backend.
- CI builds the Angular PWA; service worker versioning handles instant updates.

## 9. Architecture decision records (summary)

- **ADR-1 PWA over native** — no Apple dev account; URL distribution; Capacitor retained as future
  native path.
- **ADR-2 Supabase/Postgres over Firestore** — relational scoring math in SQL.
- **ADR-3 Append-only observations** — conflict-free multi-coach sync; multiple times per swimmer are
  a feature, not a bug.
- **ADR-4 Scheduled vs physical heats** — supports live combined/mixed heats without touching the
  immutable printed program.
- **ADR-5 Per-event points table** — relays and other schemes are configuration, not code.
- **ADR-6 Tie handling** — tied lanes share a place and each gets full points for that place, no split.
- **ADR-7 Multi-team modeling** — every team at the meet gets real `teams`/`swimmers` rows, not just
  "my team," since coaches log reference times and top-6 points for opposing swimmers too.
- **ADR-8 Materialized results** — `results` is a stored, recomputed-on-write table (mirrored locally
  for offline), not a live SQL view.
- **ADR-9 PDF import adapters** — pluggable per-format parsers behind a common IR, plus multi-file
  merge into one draft meet; never silently drop unparsed rows.
- **ADR-10 Physical-heat materialization** — publish auto-copies every `scheduled_heat`/
  `scheduled_lane` into `physical_heat`/`physical_lane`; the app reads only physical data once live.

Full ADRs: [`docs/adr/`](adr/).

## 10. Open technical questions

- ~~Relay scoring values/depth~~ — resolved: 14/10/8/6/4/2, seeded as `relay-default` in
  `points_tables`/`points_rows` (see `SPEC.md` §2).
- Tie-handling **place-numbering** convention: skip ahead after a tie (1,2,2,4) or stay dense
  (1,2,2,3)? Point-per-tie is resolved (ADR-6); this is the remaining piece.
- PDF source format: **mostly resolved** — two real formats seen so far (HY-TEK Crystal Reports;
  Excel two-column export), handled via ADR-9's adapter model. `event_no` stability across multiple
  files of the same meet is now confirmed (ADR-9). Still open: whether more generator formats exist
  (Colorado Timing, scanned/OCR — original concern) beyond these two.
- Whether LAN peer sync is needed for dead venues.