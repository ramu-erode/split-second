# ADR-9: PDF import via pluggable format adapters + multi-file merge

**Status:** Accepted · **Date:** 2026-07-14

## Context

`SPEC.md` §5.1 assumed one Order of Events PDF per meet. Two real sample files show that's wrong on
two axes:

1. **Format.** `80_Senior_Start List_TNSAA.pdf` (Senior State) is a HY-TEK Meet Manager / Crystal
   Reports export: single column, `Heat N of M Timed Finals`, columns `Lane / Name / Age / Team /
   Seed Time`, no-time shown as `NT`. `(1A) Start_List_Sub Jr_ Jr-2025 (Day 1 Morning) - F.pdf`
   (age-group Sub-Junior/Junior State) is an **Excel export**: two events laid out side by side per
   page, heats labeled `Time Trails N` (individual) or `Time Trail-N` (relay — inconsistent even
   within the same file), no Age column, no-time shown as `xxxxx` or blank, lane numbers sometimes
   starting at 0, and event-header phrasing that varies row to row (`"Boys-Group I"` vs
   `"-Group-III Boys"`). A single regex/line-scan parser cannot cover both, and the two-column page
   layout means naive `pdftotext -layout` output interleaves adjacent events' rows — extraction needs
   word-position (bounding-box) data, not just linear text, for that format.
2. **File count.** Coaches described receiving one PDF **per day per session** (Day 1 Morning, Day 1
   Evening, ... Day 3 Evening) for a single meet, not one file for the whole meet. The Senior file
   happens to contain a whole meet's events; the age-group file explicitly covers one session only
   (`"Day 1, 18th July 2025 Morning Session"`) and only the events/groups scheduled in that session.

This changes the shape of the pre-meet ingestion workflow (`SPEC.md` §5.1): "upload a PDF" becomes
"upload one or more PDFs, of possibly different formats, incrementally, into one draft meet."

A third sample — `(2B) Start_List__Sub Jr_ Jr-2025 (Day 2 Evening) - F.pdf`, same 2025 Sub-Jr/Jr
meet, same Excel format as the Day 1 file — confirmed and refined several of the above:

- **`event_no` is a stable, meet-wide sequence, not per-session.** Day 1 Morning holds events 1–26;
  Day 2 Evening holds events 79–104, contiguous, zero overlap with Day 1 or with each other. This
  resolves the merge-key question below in favor of `event_no`.
- **Event-header lines have inconsistent leading whitespace** (`"81. 400m IM-Group-II Boys"` vs
  `" 81. 400m IM-Group-II Boys"` with a leading space, both in the same file). A first-pass
  `grep -n "^[0-9]+\."` scan of this file silently missed events 81/82 for exactly this reason — a
  live demonstration of the "never silently drop" rule below, not a hypothetical.
- **The no-time sentinel's case varies by file**: Day 1 Morning uses `xxxxx` throughout; Day 2
  Evening uses `XXXXX` throughout. Matching must be case-insensitive.
- **The meet title string is not stable across a meet's own files**: Day 1 reads `"...Tamilnadu
  Senior State Aquatic Championship-2025"`; Day 2 reads `"...Tamilnadu State Aquatic
  Championship-2025"` (missing "Senior") — same meet (same "41st Sub Junior and 51st Junior"
  identifiers, complementary event ranges), different title text. A coach uploading a new file
  cannot be auto-matched to an existing draft meet by exact title string; matching needs to be fuzzy
  and/or confirmed by the coach ("attach this file to meet X?").
- **Lane-table column headers vary within a single file**, not just across files: relay events show
  `LANE CLUB NAME ... TIMING` (team-only rows), individual events show `LANE NAME ... CLUB ...
  TIMING`, and on at least one page adjacent header cells visually merged into `"LANE NONAME"` under
  linear text extraction — a second, independent case reinforcing the bbox-extraction decision below.

## Decision

**Format adapters behind a common interface.** Each adapter parses its source format into the same
normalized intermediate representation (IR) — a list of `{event_no, name, distance_m, stroke,
gender, age_group, is_relay, heats: [{heat_no, lanes: [{lane_no, swimmer_name | team_name,
relay_letter?, club, age?, seed_time_ms | null}]}]}`. Two adapters to start:
`hytek-crystal-reports` (linear text, `Heat N of M` parsing) and `excel-two-column`
(position/bbox-aware, `Time Trail(s) N` parsing, tolerant of the header-phrasing drift already
observed). Format is auto-detected from PDF producer metadata plus content sniffing (presence of
`"Heat \d+ of \d+"` vs `"Time Trail"` tokens), with manual override if detection is wrong.

**Import is multi-file and incremental.** A draft meet accepts repeated uploads over time (as each
session's PDF becomes available) rather than a single one-shot file. Each upload is parsed by the
detected adapter into the IR, then merged into the meet's `events`/`scheduled_heats`/
`scheduled_lanes`.

**Merge key.** Confirmed with two session files from the same meet (Day 1 Morning: events 1–26; Day
2 Evening: events 79–104, contiguous and non-overlapping): `event_no` is assigned once, meet-wide,
regardless of which session file it ends up printed in. `event_no` is the primary merge key. The
composite `(distance_m, stroke, gender, age_group, is_relay)` is kept as a secondary check — if a
given `event_no` shows up in two files with a differing composite (or differing lane/swimmer
content), that's a merge conflict surfaced to the coach during review, never silently overwritten or
silently trusted. Because meet title text isn't stable across a meet's own files (see above),
attaching an upload to an existing draft meet is a coach-confirmed action (fuzzy-matched suggestion,
not automatic), not something inferred from the title string alone.

**Never silently drop.** Given the header-phrasing, whitespace, and terminology drift observed even
within one file, adapters must route anything they can't confidently parse into a `needs_review`
bucket rather than skipping it or guessing — and header/token matching must tolerate leading/trailing
whitespace and be case-insensitive by default, not just for the tokens known today. `SPEC.md` §5.1
already requires a coach review-and-correct step before publish, so the parser's job is "best-effort
structured candidate," not "perfect." The review UI should also show a **parsed event-number range
per uploaded file** (e.g. "this file covers events 79–104") so a coach can visually catch a gap or
an unexpectedly-missing event at a glance — cheap to compute, and would have caught the events-81/82
whitespace bug immediately even before any regex fix.

**Provenance.** `scheduled_heats` carries a nullable `source_file_id` / `source_page` so the review
UI can show "this heat came from page 4 of Day 1 Morning" — useful both for correcting parse errors
and for resolving conflicts when the same event appears in two uploaded files.

### Schema additions

```
meet_source_files (id, meet_id, filename, format_detected,        -- 'hytek-crystal-reports' | 'excel-two-column' | ...
                   day_no, session,                                -- session: 'morning' | 'evening' | ... (free text; TBD enum)
                   uploaded_by references coaches, uploaded_at,
                   status)                                         -- 'parsed' | 'needs_review' | 'merged'

scheduled_heats.source_file_id  nullable references meet_source_files
scheduled_heats.source_page     int nullable
```
(`scheduled_lanes` inherits provenance via its `scheduled_heat_id`; no separate column needed.)

## Consequences

- The Import screen becomes a repeatable "add another file" flow against a draft meet, not a
  single-shot upload — more UI states (partially-imported meet, per-file status), but matches how
  coaches actually receive these files.
- Two parsers to build and maintain instead of one, and the second one needs position-aware PDF
  extraction (e.g. pdf.js text-item coordinates), which is more engineering than linear text
  scanning. A third generator format (Colorado Timing, scanned/OCR — `SPEC.md` §11 open question)
  can be added later as another adapter without touching the merge/staging logic.
- Both sample files also revealed drift in tie-adjacent details worth flagging for the parser, not
  the schema: `NT` vs `xxxxx` vs blank all mean "no seed time" and must normalize to
  `seed_time_ms = null`; lane numbering isn't reliably 1-based.
- Merge-conflict UI is new surface area not previously scoped — needed as soon as two files could
  plausibly describe the same event differently.
- Because `event_no` is now the trusted merge key, a parser bug that mis-reads or drops an event
  number (as the whitespace case above shows can happen trivially) directly corrupts merge behavior,
  not just that one file's data — raises the cost of the "never silently drop" and range-display
  safeguards from nice-to-have to load-bearing.

## Alternatives considered

- **Single universal parser** — rejected; the two sample files differ in column layout, heat
  terminology, and available fields (age present vs absent) enough that one regex/line-scan strategy
  cannot cover both, and the two-column layout structurally requires positional extraction.
- **One-file-per-meet assumption (original SPEC §5.1 wording)** — rejected; contradicted by how
  coaches actually receive these files (per-day, per-session).
- **Require coach to fully re-key each session's program by hand** — rejected; defeats the purpose of
  PDF import, which exists specifically to remove that manual-transcription burden.
