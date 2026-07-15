# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in the **SplitSecond** repo.

## What this project is

A mobile-first **PWA** that helps swim coaches automate their pool-deck workflow at state
competitions: tracking their swimmers' heats, capturing splits and final times, recording the
top-6 finish times per event, and computing live team points.

Read `SPEC.md` (product) and `architecture.md` (technical) before making non-trivial changes.

## Stack

- **Angular** + **Ionic** UI, delivered as a **PWA** (service worker + IndexedDB, fully offline-capable).
- **Capacitor** is kept in the project as a future native-app path but is not the primary target.
- **Supabase** (Postgres + Realtime + Auth) backend.
- **Google Stitch** is used to draft UI; production UI is built with Ionic components.

## Commands

App lives in `splitsecond/`. Run these from that directory:

```bash
npm install
npm start            # ng serve
npm run build        # production PWA build
npm test             # unit tests (karma/jasmine)
npm run lint
```

Do not invent commands — check `splitsecond/package.json` before running anything.

## Domain glossary (get these right)

- **Order of Events** — the printed program: events → heats → lanes.
- **Event** — a race (distance + stroke + gender + age group), individual or relay.
- **Scheduled heat** — a heat as printed on the PDF. **Immutable after the meet is published.**
- **Physical heat** — a heat as actually swum; may **combine** several scheduled heats. One physical
  heat = one start/gun = one timing session.
- **Lane** — carries the swimmer, team, seed time, and its own **scoring category**
  (event/gender/age group) so mixed/combined heats still score correctly.
- **Split** — an intermediate time within a swim.
- **Observation** — one coach's recorded timing for one lane (splits + final), with a `source`
  flag (`stopwatch` | `manual`).

## Scoring (do not hardcode a linear scale)

Individual events: **1st=7, 2nd=5, 3rd=4, 4th=3, 5th=2, 6th=1** — the scheme **skips 6**.
Relay events: **1st=14, 2nd=10, 3rd=8, 4th=6, 5th=4, 6th=2** — double the individual scale, same
skip-a-value shape. Points always come from the **per-event points table**
(`individual-default` / `relay-default`), never a hardcoded literal in logic.
Ranking is **per event across all heats**, by time.

## Invariants — do not break these

1. **Observations are append-only.** Each has a client-generated UUID and a `coach_id`. Never
   overwrite another coach's observation; corrections update the record's own row (`updated_at` /
   `deleted`). Multiple observations per swimmer are expected and valid.
2. **Scheduled data is immutable after publish.** Live changes go to `physical_heats` /
   `physical_lanes`, never back into the scheduled tables.
3. **Scoring category lives on the lane**, not the heat.
4. **Structural edits** (combine heats, re-seat lanes, scratches) are **Scorer/head-coach role only**
   and must be written to `activity_log`.
5. **Offline-first.** Every feature must work with zero connectivity; nothing may hard-depend on a
   live network call in the deck flow.
6. **Points come from the points table**, never a hardcoded 7/5/4/3/2/1 literal in logic.

## Conventions

- TypeScript strict mode; prefer typed models in `core/`. No `any`, no unexplained non-null
  assertions.
- Feature modules are lazy-loaded (see `architecture.md` §6): `meet-import/`, `order-of-events/`,
  `timing/`, `heats/`, `scoring/`, `sync/`, `core/`.
- Keep the **timing screen** simple and high-contrast with large tap targets — it is used under time
  pressure on a bright pool deck.
- Times are stored in **milliseconds (`*_ms`)** integers; format to `mm:ss.hh` only in the UI.
- Identifiers use the **domain glossary** terms exactly (Scheduled heat / Physical heat /
  Observation / etc.) — never a synonym like "session" for heat or "entry" for observation.

### Component architecture

- **Single Responsibility per method** — max ~10–15 lines; extract private helpers rather than
  growing one method. Applies to services/stores too, not just components.
- **Extract a child component** once a template block exceeds ~5 lines of markup, instead of letting
  one template grow long.
- **Signals everywhere** — component state, store state, and inputs/outputs are all signal-based:
  `input()` / `model()` / `output()`, `computed()`, `effect()`. No `@Input()`/`@Output()` decorators,
  no plain mutable class fields for state that drives the view.
- **New control-flow syntax** — `@if` / `@for` / `@switch`, not `*ngIf` / `*ngFor`.
- **`ChangeDetectionStrategy.OnPush`** on every component, no exceptions.
- **Standalone only** — no NgModules.
- **Smart/dumb split**: only routed "page" components inject a store or service. Presentational
  components receive data via signal inputs and emit via `output()` — they never inject
  `SupabaseService` or a store directly. Keeps every non-page component testable with zero mocking.

### State / store pattern

- Don't dump business logic in `*.component.ts` — components are presentation only. Introduce a
  store (or a plain injectable service for simpler cases) that exposes signals.
- **Strict layering, enforced, not just conventional:** `Component → Store (signals) → local
  IndexedDB store → sync engine → Supabase`. A component (or a presentational piece) never calls
  `SupabaseService` directly — that's what makes the offline-first invariant (#5 above) actually
  hold in code, not just in intent.
- **Consistent store shape** — expose state as a small status discriminant (`idle | loading | loaded
  | error`), not independent `loading`/`data`/`error` fields that can drift out of sync with each
  other.
- **Immutable updates** — replace arrays/objects in a signal, never mutate in place, or downstream
  `computed()`/`effect()` goes stale.

### Files

- One component per folder, co-located `.ts` / `.html` / `.scss` / `.spec.ts`.
- No barrel (`index.ts`) files — explicit imports keep lazy-loading boundaries honest.

## Open questions (unresolved — ask before assuming)

- Number of coaches on deck simultaneously (assume 2–5).
- PDF source format beyond the two confirmed (Hy-Tek Crystal Reports; Excel two-column) — Colorado
  Timing / scanned still unconfirmed.
- Tie-handling **place-numbering** convention (skip after a tie vs stay dense) — point-per-tie is
  resolved (full points to each, no split).