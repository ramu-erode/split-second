# Plan: stop re-fetching the whole meet on every load

Status: **implemented** (2026-07-16). Written after Ramu reported the app is slow and described
the target behavior (sync program data once, hard-refresh button on More tab, Realtime for
cross-coach observation sync). See `architecture.md` §4, which already specified this split
conceptually but it was never implemented in code.

**Follow-up fix (same day):** a hard page reload always re-runs `fetchAvailableMeets()` (which
meets exist) and `syncLiveData()` (observations/splits catch-up) against Supabase — by design, see
below — but neither was resilient to being offline at that exact moment, which meant a hard reload
while offline threw and blanked the whole page even though the cached program data was sitting
right there in IndexedDB. Fixed: `fetchAvailableMeets()` now caches its result into `db.meets` and
falls back to that cache on failure; `syncLiveData()`'s failure inside `loadMeet()` is now
non-fatal (logged, not thrown) since `loadFromCache()` already populated observations/splits
locally. Both live in `meet-data.store.ts`.

**Follow-up fix #2 (same day): incremental `syncLiveData`.** Even bounded to one meet's lanes,
`syncLiveData` was still a *full* refetch of every observation/split every single load — slow once
a meet accumulates thousands of recorded times over a multi-day competition. Changed to
incremental: `syncMeta` gained a second per-meet field, `liveDataSyncedAt`, a high-water mark on
`observations.updated_at`. Each `syncLiveData(meetId)` call now fetches only rows with
`updated_at >= liveDataSyncedAt` (append-only inserts *and* retractions both bump that column —
CLAUDE.md invariant #1), merges them into the existing IndexedDB/signal state via a new
`mergeIntoCache` helper (upsert-by-id, not `fetchAndCacheByIds`'s wholesale replace), then advances
the bookmark to the max `updated_at` actually seen. Splits need no separate bookmark — they're
immutable once created and always inserted alongside their parent observation, so fetching splits
for just this round's changed observation ids is sufficient. `fetchAndCacheByIds` was refactored to
share its chunked/paginated fetch logic (`fetchRowsByIds`) with this new incremental path, rather
than duplicating the pagination loop.

**Follow-up fix #3 (same day): stop chunking the observations fetch by lane id.** Even after fix
#2, Ramu reported 65+ requests to `observations` on every reload. Cause: the incremental fetch was
still scoped with `.in('physical_lane_id', idsChunk)`, chunked at 150 ids per PostgREST request
(`ID_CHUNK_SIZE`) — so request count scaled with **the meet's total lane count**, not with how much
data had actually changed. A meet with a few thousand lanes meant 20-60+ requests every load just
to hear back "nothing new" for most chunks. Fix: `observations_select` RLS
(`supabase/migrations/20260714000002_rls.sql`) already grants every signed-in coach read access to
every observation regardless of meet — so the lane-id scoping bought no security, only request
count. `syncLiveData` now queries `observations` by `since` alone (no `.in()`), then filters the
result client-side to this meet's lane ids before merging into cache/signal (same pattern the
Realtime handlers already use). Request count now tracks the size of the actual delta, not the
size of the meet. Extracted a shared `fetchRows` pagination primitive so `fetchAndCache`,
`fetchAndCacheByIds`/`fetchRowsByIds`, and this new unscoped path all reuse one implementation.

## Root cause

Every call to `load()` / `selectMeet()` in
[`meet-data.store.ts`](../splitsecond/src/app/core/data/meet-data.store.ts) runs
`loadFromCache()` (fast, IndexedDB) immediately followed by `refreshFromSupabase()` (slow) — and
`refreshFromSupabase` unconditionally re-fetches **everything** over the network every time:
events, scheduled_heats, physical_heats, physical_heat_sources, physical_lanes, points
tables/rows, and — worst of all — **every team and every swimmer across every meet in the whole
database**, paginated in `FETCH_PAGE_SIZE` (500-row) chunks. This runs on first app load, every
`selectMeet()`, and every pull-to-refresh across Upcoming/Timing/Results/Leaderboard, even though
the same data was just read from IndexedDB a moment earlier.

## Direction (from Ramu, 2026-07-16)

- Treat the **printed program** (events / scheduled+physical heats / lanes / teams / swimmers /
  points tables) as fetch-once-per-meet, cached locally — don't keep re-pulling it automatically.
- Add a manual **hard-refresh** control on the More tab for when a coach explicitly wants the
  latest structural state (e.g. after a Scorer combines heats while this device was offline).
- Keep **observations/results syncing live between coaches** via Supabase Realtime (assume
  internet at the meet most of the time), without dropping offline capability entirely.
- Lane re-seating/reassignment UX is explicitly out of scope for this pass.

Good news: the Realtime channel needed for live cross-coach sync **already exists** —
`subscribeRealtime()` in meet-data.store.ts already listens on `physical_heats`, `physical_lanes`,
`observations`, and `splits` and patches both the signal and IndexedDB on every change. That part
needs no new work. The fix is entirely about *what gets fetched over the network on `load()`*.

## Approach

Split today's single `refreshFromSupabase(meetId)` into two methods in `meet-data.store.ts`:

1. **`syncProgramData(meetId)`** — events, scheduled_heats, physical_heats,
   physical_heat_sources, physical_lanes, teams, swimmers, points_tables, points_rows (today's
   `refreshFromSupabase` minus the observations/splits tail). Runs only:
   - the first time a given meet is ever loaded on this device (no cached program data yet), or
   - when the coach explicitly taps **hard refresh**.
2. **`syncLiveData(meetId)`** — observations + splits scoped to this meet's already-known lane
   ids (today's `refreshFromSupabase` tail, unchanged logic). Still runs on every `load()` /
   `selectMeet()` — this is bounded to one meet's lanes, not the whole database, so it's cheap,
   and it's what catches up anything missed while the app was closed (Realtime only runs while
   the app is open) before the Realtime subscription takes over for the rest of the session.

`loadMeet(meetId)` becomes:
```
loadFromCache(meetId)
if (no syncMeta row for this meetId) await syncProgramData(meetId)   // first time only
await syncLiveData(meetId)                                            // always, cheap
subscribeRealtime(meetId)                                             // unchanged
```

**Tracking "already synced once"**: add a small Dexie table `syncMeta: { meetId, programSyncedAt
}` via `this.version(3).stores({ syncMeta: 'meetId' })` in
[`local-db.service.ts`](../splitsecond/src/app/core/data/local-db.service.ts), following the same
versioned-stores pattern already used for v1/v2. Using an explicit flag (rather than "are
physicalHeats/physicalLanes empty") avoids misfiring on a meet that legitimately has zero heats
yet.

**`hardRefresh()`** (new public method on `MeetDataStore`): re-runs `syncProgramData` +
`syncLiveData` for the current meet, updates `syncMeta.programSyncedAt`, and updates a new
`lastSyncedAt` readonly signal. Uses its own `_syncing` signal rather than touching the existing
`_status`/`_error` signals — those drive full-page loading/error states elsewhere (see
`upcoming.page.html`'s `@if (status() === 'loading')` / `'error'` blocks), and a failed manual
refresh with good cache already on screen shouldn't blank the page. On failure, set a transient
`_syncError` message signal instead (cleared on next attempt), leave existing cached data in
place.

**More tab UI**
([`more.page.ts`](../splitsecond/src/app/more/more.page.ts) / `more.page.html`): add an
`ion-item button` "Refresh meet data" calling `meetDataStore.hardRefresh()`, showing:
- "Syncing…" while `syncing()` is true (disable the button meanwhile)
- "Last synced <relative time>" from `lastSyncedAt()` once known
- the transient error message inline if the last attempt failed

No changes needed to the individual page components (Upcoming/Timing/Results/Leaderboard) — their
existing `load()` / `selectMeet()` / pull-to-refresh calls automatically become cheap once the
store internals change, since they all funnel through the same `loadMeet()`.

## Explicitly out of scope

- Lane reassignment/re-seating UI.
- Removing offline capability — `loadFromCache` remains the first thing every load does; the app
  still works fully offline once a meet has been synced once.
- A full sync-queue/outbox rewrite — `recordObservation`'s existing best-effort push + Realtime
  catch-up remains the write path; not touched by this change.

## Files to touch

- `splitsecond/src/app/core/data/meet-data.store.ts` — split `refreshFromSupabase`, add
  `syncMeta` check, `hardRefresh()`, `syncing`/`lastSyncedAt`/`syncError` signals.
- `splitsecond/src/app/core/data/local-db.service.ts` — add `syncMeta` table, bump to
  `version(3)`.
- `splitsecond/src/app/more/more.page.ts` / `more.page.html` — hard-refresh button + status text.

## Verification

- `npm test` (karma/jasmine) in `splitsecond/` for any existing store specs.
- `npm run build` to confirm no TS errors from the Dexie version bump / new signals.
- Manually run the app (`npm start`), open a meet once (confirm program data loads), then reload
  the page / revisit tabs and confirm (via Network tab) that events/heats/lanes/teams/swimmers are
  NOT re-fetched, only observations/splits are. Then use the More tab's hard-refresh button and
  confirm a full re-fetch happens and `lastSyncedAt` updates. If two coach sessions are available,
  confirm an observation recorded on one appears on the other without a hard refresh (Realtime).
