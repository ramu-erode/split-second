# SplitSecond — Product Spec & Technical Plan

**Status:** Draft v0.1 · **Last updated:** 2026-07-13
**Owner:** Ramu

> A mobile-first PWA that automates what swim coaches currently do by hand on a printed
> Order of Events: track their swimmers' heats, capture splits and final times, record the
> top-6 finish times of every event, and compute live team points.

---

## 1. Problem

At a state competition, a coach works from a printed **Order of Events** (heat sheet). During the
meet they manually:

- Watch for the heats their team's swimmers are in.
- Take **splits and final time** for each of their own swimmers with a stopwatch.
- Record the **times of the top 6 finishers** in every event, because those places score
  team points.
- Write all of it, by hand, onto the paper program.

This is error-prone, slow, hard to share between multiple coaches on deck, and gives no live
view of the team's standing. SplitSecond automates as much of this as possible.

## 2. Scoring rules

| Place            | 1st | 2nd | 3rd | 4th | 5th | 6th |
|------------------|-----|-----|-----|-----|-----|-----|
| Individual points| 7   | 5   | 4   | 3   | 2   | 1   |
| Relay points     | 14  | 10  | 8   | 6   | 4   | 2   |

> Both schemes **skip a value** on the way down (individual: 7→5; relay: 14→10) — the app must not
> assume a linear scale for either. Relay points are exactly double the individual scale, same
> shape. Both are seeded as separate rows in `points_tables`/`points_rows` (`individual-default`,
> `relay-default`) — never hardcoded in scoring logic.

- Places are ranked by **time across the whole event** (all heats combined), not per heat.
  The scoring engine is built to read a per-event points table so relays are a config change,
  not a code change.

## 3. Users & roles

A team fields **multiple coaches on deck** (exact count **TBD** — assume 2–5). Two functional roles,
switchable per device:

- **Timer** — focuses on the team's own swimmers: splits + final times.
- **Scorer / Head coach** — captures top-6 finish times for points and holds authority over
  **structural edits** (combining heats, re-seating lanes). Sees the live leaderboard.

A coach can hold both roles; roles just tailor the screen.

## 4. Key domain concepts

- **Order of Events** — the full program: events → heats → lanes.
- **Event** — e.g. "Event 12, Girls 100m Freestyle." Has stroke, distance, gender, age group,
  and `is_relay`.
- **Scheduled heat** — a heat as printed on the PDF (locked ~2 days before the meet).
- **Physical heat** — a heat as actually swum on deck. May combine one or more scheduled heats
  (see §7). One physical heat = one start/gun = one timing session.
- **Lane** — a lane within a heat holding a swimmer, their team, and seed time. Each lane carries
  its own scoring **category** (event / gender / age group) so mixed heats still score correctly.
- **Split** — an intermediate time within a swim (e.g. every 50m).
- **Observation** — one coach's recorded timing for one lane (splits + final), with a `source`
  flag (`stopwatch` or `manual`). Multiple coaches may record the same lane; all observations
  are kept.

## 5. Workflows

### 5.1 Pre-meet (desktop/web, ~2 days out)
1. Coach receives the Order of Events PDF.
2. Uploads it to the **Import screen**; it parses into events / heats / lanes / swimmers.
3. Coach reviews and corrects the parse, flags **"my team,"** then **publishes** the meet.
4. All coaches' devices sync the meet while they still have connectivity.

### 5.2 On deck (mobile PWA, offline)
1. **Upcoming view** highlights the next heats containing the team's swimmers.
2. When a swimmer's heat is up, coach opens the **heat/timing screen**.
3. Coach captures splits + final time — via **live stopwatch**, **manual keypad entry**, or a mix,
   and can edit afterward.
4. Scorer captures the **top-6 finish times** for the event.
5. App auto-computes team points and updates the **live leaderboard / running total**.
6. Everything syncs across coach devices as connectivity allows; works fully offline in between.

### 5.3 Combined heats (on deck) — see §7
Scorer combines scheduled heats, eyeballs the deck, and re-seats swimmers into their actual lanes.

## 6. Multi-coach collaboration model

The central design decision: **every timing is an independent, append-only observation**, not a
shared editable cell.

- Each observation has a **client-generated UUID** and records `coach_id`, `source`, splits, final.
- Two coaches timing **different** swimmers never collide.
- Two coaches timing the **same** swimmer produce two observations — useful, since hand times differ;
  the app can average or let you pick (weighting `manual`/scoreboard times higher).
- Because writes are append-only with unique IDs, **sync merges have no real conflicts.**
- **Structural edits** (combine heats, re-seat lanes) are the exception — they mutate shared state,
  so only the **Scorer/head-coach role** may make them; changes broadcast to all devices with an
  activity log.

## 7. Combined heats

The printed structure is a starting point that can change live. Two cases:

1. **Merged under-filled heats** — e.g. Heat 3 (4 swimmers) + Heat 4 (3) run as one physical heat.
   One start, one gun → one timing session. Lanes get reassigned on deck.
2. **Mixed-category heats** — one physical heat contains swimmers who score separately (boys + girls,
   or two age divisions). They race together but points are computed per category.

**Design:** separate **scheduled heat** from **physical heat**. A physical heat maps to one or more
scheduled heats. Each occupied lane carries its own category, so scoring buckets correctly regardless
of how heats are physically combined. Scoring logic is unchanged — it reads the lane's category, not
the heat.

**Lane assignment is manual (eyeball & place):** coaches are not always told the new lane numbers, so
the app provides a fast **tap-a-lane → assign swimmer** interface (pick from the merged heats, or
search the full roster for a deck entry not on the sheet), plus marking **scratches / no-shows**.

## 8. Manual time entry

Every time field (final and each split) is editable via a **numeric keypad (mm:ss.hh)**. A coach can:
- run the live stopwatch, or
- key in a time read off the scoreboard, or
- overwrite a hand time with the official one afterward.

Each observation stores a **`source` flag (`stopwatch` | `manual`)** used during reconciliation —
scoreboard/manual times are generally more trustworthy than hand-held stopwatch times.

## 9. Feature list

### MVP
- PDF import + review/correct + publish meet (pre-meet).
- Order of Events browser; "my team" filtering; upcoming-heats view.
- Heat/timing screen: live stopwatch, splits, manual entry, edit.
- Top-6 finish-time capture per event.
- Scoring engine + live leaderboard (individual events; relay values are known — see §2 — but relay
  scoring itself is scoped under "Later" below unless promoted).
- Combined-heat handling + manual lane re-seating + scratches.
- Multi-coach append-only sync; full offline operation.
- Roles (Timer / Scorer).

### Later
- Relay scoring engine wiring (point values are now known — §2 — this is about extending the
  scoring/leaderboard implementation to relay events, not waiting on rules anymore).
- Reconciliation UI for multiple observations (average / pick / weight).
- Swimmer history & personal-best tracking across meets.
- Export results / share.
- Local/LAN peer sync fallback if pool connectivity proves too dead.

### Non-goals (for now)
- Not an official timing/results system (no Colorado Timing hardware integration).
- Not a meet-management/entry tool (that lives in Hy-Tek etc.).
- No spectator-facing features.

## 10. Technical stack

| Concern | Choice | Why |
|---------|--------|-----|
| Framework | **Angular** | Ramu's existing expertise |
| Mobile UI | **Ionic** | Cross-platform components, native feel, big tap targets |
| Delivery | **PWA** | No Apple developer account needed; ship a URL; installs to home screen |
| Native escape hatch | **Capacitor** | Same codebase → native iOS/Android later, no rewrite |
| Backend | **Supabase** (Postgres + Realtime + Auth) | SQL fits the relational meet/scoring model; realtime sync |
| Offline store | Service worker + IndexedDB | Full offline on the pool deck |
| Design | **Google Stitch** → Ionic | Prompt-to-UI with Angular export as a styling reference; build for real in Ionic |

See `architecture.md` for the data model, sync design, and screen structure.

## 11. Open questions

1. ~~**Relay scoring rules**~~ — **resolved**: 14/10/8/6/4/2 (double the individual scale, same
   skip-a-value shape). Seeded as `relay-default` in `points_tables`. Depth (top-6, same as
   individual) assumed unless told otherwise.
2. **Coach count** on deck at once — affects collaboration UI. *(Ramu to confirm; assume 2–5.)*
3. **PDF source** — *(partially confirmed)* two real formats seen: HY-TEK Meet Manager/Crystal
   Reports (Senior State) and an Excel export (Sub-Junior/Junior age-group). They differ enough
   (single- vs two-column layout, heat terminology, available fields) to need separate parser
   adapters — see `architecture.md` ADR-9. Still open: whether Colorado Timing or scanned/OCR
   sources also occur, and whether more meets arrive as multiple per-day/session files (confirmed
   for the age-group meet) needing merge into one meet's program.
4. Backend final call: Supabase vs Firebase (leaning Supabase).

## 12. Rough phases

1. **Foundations** — Angular + Ionic PWA shell, Supabase schema, auth, offline store.
2. **Pre-meet ingestion** — PDF import → review → publish.
3. **On-deck core** — timing screen (stopwatch/splits/manual), upcoming view.
4. **Scoring** — top-6 capture, points engine, live leaderboard.
5. **Collaboration** — multi-coach sync, roles, combined heats, re-seating.
6. **Polish** — reconciliation, relays, export.