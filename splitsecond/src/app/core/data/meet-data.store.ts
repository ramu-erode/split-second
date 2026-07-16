import { Injectable, computed, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import { LocalDbService, SyncMeta } from './local-db.service';
import {
  mapEvent,
  mapMeet,
  mapObservation,
  mapPhysicalHeat,
  mapPhysicalHeatSource,
  mapPhysicalLane,
  mapPointsRow,
  mapPointsTable,
  mapScheduledHeat,
  mapSplit,
  mapSwimmer,
  mapTeam,
} from './row-mappers';
import {
  Event,
  Meet,
  Observation,
  ObservationSource,
  PhysicalHeat,
  PhysicalHeatSource,
  PhysicalHeatStatus,
  PhysicalLane,
  PointsRow,
  PointsTable,
  ScheduledHeat,
  Split,
  Swimmer,
  Team,
} from '../models/domain.models';

// Keeps `.in(column, ids)` request URLs well under PostgREST/proxy length limits — see
// fetchAndCacheByIds below.
const ID_CHUNK_SIZE = 150;

// A conservative page size for fetchAndCache's .range() pagination — see the comment there for why
// this can't just be "the whole table in one request" anymore.
const FETCH_PAGE_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const SELECTED_MEET_KEY = 'splitsecond:selectedMeetId';

// "Since the beginning of time" — the default cutoff for syncLiveData's incremental fetch when a
// meet has never been live-synced on this device before, so the same `.gte('updated_at', since)`
// query shape covers both the first fetch and every incremental one after it.
const EPOCH = '1970-01-01T00:00:00.000Z';

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface NewObservation {
  physicalLaneId: string;
  coachId: string;
  finalTimeMs: number;
  source: ObservationSource;
  splits?: { splitNo: number; splitMs: number }[];
}

// Shared cross-feature data: the current meet's program + live physical state. Order of Events,
// Timing, and Leaderboard all read from this rather than querying Supabase themselves — keeps the
// "component never calls SupabaseService directly" layering rule in one place (CLAUDE.md).
@Injectable({ providedIn: 'root' })
export class MeetDataStore {
  private readonly supabase = inject(SupabaseService).client;
  private readonly db = inject(LocalDbService);

  private readonly _status = signal<LoadStatus>('idle');
  private readonly _error = signal<string | null>(null);
  private readonly _syncing = signal(false);
  private readonly _syncError = signal<string | null>(null);
  private readonly _lastSyncedAt = signal<string | null>(null);
  private readonly _meet = signal<Meet | null>(null);
  private readonly _availableMeets = signal<Meet[]>([]);
  private readonly _events = signal<Event[]>([]);
  private readonly _scheduledHeats = signal<ScheduledHeat[]>([]);
  private readonly _physicalHeats = signal<PhysicalHeat[]>([]);
  private readonly _physicalHeatSources = signal<PhysicalHeatSource[]>([]);
  private readonly _physicalLanes = signal<PhysicalLane[]>([]);
  private readonly _teams = signal<Team[]>([]);
  private readonly _swimmers = signal<Swimmer[]>([]);
  private readonly _observations = signal<Observation[]>([]);
  private readonly _splits = signal<Split[]>([]);
  private readonly _pointsTables = signal<PointsTable[]>([]);
  private readonly _pointsRows = signal<PointsRow[]>([]);

  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();
  readonly syncing = this._syncing.asReadonly();
  readonly syncError = this._syncError.asReadonly();
  readonly lastSyncedAt = this._lastSyncedAt.asReadonly();
  readonly meet = this._meet.asReadonly();
  readonly availableMeets = this._availableMeets.asReadonly();
  readonly events = this._events.asReadonly();
  readonly physicalHeats = this._physicalHeats.asReadonly();
  readonly physicalLanes = this._physicalLanes.asReadonly();
  readonly teams = this._teams.asReadonly();
  readonly swimmers = this._swimmers.asReadonly();
  readonly observations = this._observations.asReadonly();

  readonly eventsById = computed(() => new Map(this._events().map((e) => [e.id, e])));
  readonly teamsById = computed(() => new Map(this._teams().map((t) => [t.id, t])));
  readonly swimmersById = computed(() => new Map(this._swimmers().map((s) => [s.id, s])));
  readonly lanesByHeatId = computed(() => {
    const map = new Map<string, PhysicalLane[]>();
    for (const lane of this._physicalLanes()) {
      const arr = map.get(lane.physicalHeatId) ?? [];
      arr.push(lane);
      map.set(lane.physicalHeatId, arr);
    }
    return map;
  });
  // Scoring reads lanes per event, not per heat (CLAUDE.md: "Ranking is per event across all
  // heats") — a combined/mixed heat's lanes land under whichever event each lane's category is.
  readonly lanesByEventId = computed(() => {
    const map = new Map<string, PhysicalLane[]>();
    for (const lane of this._physicalLanes()) {
      if (!lane.eventId) continue;
      const arr = map.get(lane.eventId) ?? [];
      arr.push(lane);
      map.set(lane.eventId, arr);
    }
    return map;
  });
  readonly heatNoByPhysicalHeatId = computed(() => {
    const scheduledById = new Map(this._scheduledHeats().map((h) => [h.id, h]));
    const map = new Map<string, number>();
    for (const src of this._physicalHeatSources()) {
      const heatNo = scheduledById.get(src.scheduledHeatId)?.heatNo;
      const existing = map.get(src.physicalHeatId);
      if (heatNo != null && (existing == null || heatNo < existing)) {
        map.set(src.physicalHeatId, heatNo);
      }
    }
    return map;
  });

  // Non-deleted observations, grouped by lane — the timing screen's and scoring engine's shared
  // read path (CLAUDE.md invariant #1: observations are append-only, corrections set `deleted`).
  readonly observationsByLaneId = computed(() => {
    const map = new Map<string, Observation[]>();
    for (const obs of this._observations()) {
      if (obs.deleted) continue;
      const arr = map.get(obs.physicalLaneId) ?? [];
      arr.push(obs);
      map.set(obs.physicalLaneId, arr);
    }
    return map;
  });
  readonly splitsByObservationId = computed(() => {
    const map = new Map<string, Split[]>();
    for (const split of this._splits()) {
      const arr = map.get(split.observationId) ?? [];
      arr.push(split);
      map.set(split.observationId, arr);
    }
    return map;
  });
  readonly pointsRowsByTableId = computed(() => {
    const map = new Map<string, PointsRow[]>();
    for (const row of this._pointsRows()) {
      const arr = map.get(row.pointsTableId) ?? [];
      arr.push(row);
      map.set(row.pointsTableId, arr);
    }
    for (const rows of map.values()) rows.sort((a, b) => a.place - b.place);
    return map;
  });

  private realtimeChannel: RealtimeChannel | null = null;

  async load(): Promise<void> {
    if (this._status() === 'loading') return;
    this._status.set('loading');
    this._error.set(null);
    try {
      const meets = await this.fetchAvailableMeets();
      this._availableMeets.set(meets);
      const meetId = this.resolveSelectedMeetId(meets);
      if (meetId) await this.loadMeet(meetId);
      else this._meet.set(null);
      this._status.set('loaded');
    } catch (e) {
      this._error.set(e instanceof Error ? e.message : 'Failed to load meet data');
      this._status.set('error');
    }
  }

  // Switches the active meet (coaches can have more than one live/published meet at once — e.g.
  // parallel age-group championships — and pick which one they're working on). Reuses the already-
  // fetched `availableMeets` list rather than re-querying it.
  async selectMeet(meetId: string): Promise<void> {
    if (meetId === this._meet()?.id) return;
    this._status.set('loading');
    this._error.set(null);
    try {
      await this.loadMeet(meetId);
      this._status.set('loaded');
    } catch (e) {
      this._error.set(e instanceof Error ? e.message : 'Failed to load meet data');
      this._status.set('error');
    }
  }

  private async loadMeet(meetId: string): Promise<void> {
    const meet = this._availableMeets().find((m) => m.id === meetId) ?? null;
    this._meet.set(meet);
    if (!meet) return;
    localStorage.setItem(SELECTED_MEET_KEY, meetId);
    await this.loadFromCache(meetId);

    const syncMeta = await this.db.syncMeta.get(meetId);
    this._lastSyncedAt.set(syncMeta?.programSyncedAt ?? null);
    // No cached program data at all yet (first time this meet's been opened on this device) — a
    // failure here is a real error, since loadFromCache above had nothing to show either.
    if (!syncMeta) await this.syncProgramData(meetId);
    try {
      await this.syncLiveData(meetId);
    } catch (e) {
      // loadFromCache already populated observations/splits locally; a failed catch-up fetch
      // (e.g. offline on a hard reload) just means slightly stale data until Realtime reconnects
      // or a hard refresh — not worth blanking the page over (CLAUDE.md invariant #5).
      console.error('Failed to sync live data from Supabase (using cached observations):', e);
    }

    this.subscribeRealtime(meetId);
  }

  // Coach-initiated re-fetch of everything for the current meet (More tab "Refresh meet data").
  // Program data is otherwise only fetched once per meet (see loadMeet) — this is the escape
  // hatch for catching up on structural changes (combined heats, re-seated lanes) made by a
  // Scorer while this device was offline or closed. Uses its own syncing/syncError signals
  // rather than `status`/`error` so a failed refresh doesn't blank a page that already has good
  // cached data on screen.
  async hardRefresh(): Promise<void> {
    const meetId = this._meet()?.id;
    if (!meetId || this._syncing()) return;
    this._syncing.set(true);
    this._syncError.set(null);
    try {
      await this.syncProgramData(meetId);
      await this.fullResyncLiveData(meetId);
    } catch (e) {
      this._syncError.set(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      this._syncing.set(false);
    }
  }

  private resolveSelectedMeetId(meets: Meet[]): string | null {
    if (meets.length === 0) return null;
    const stored = localStorage.getItem(SELECTED_MEET_KEY);
    if (stored && meets.some((m) => m.id === stored)) return stored;
    return (meets.find((m) => m.status === 'live') ?? meets[0]).id;
  }

  // Local-first write for a new timing observation (CLAUDE.md invariant #1: append-only, client
  // UUID). Always commits to IndexedDB + the in-memory signal first so the timing screen never
  // blocks on connectivity; the Supabase push is best-effort until a real sync queue exists
  // (architecture.md's `sync/` module is not built yet — see CLAUDE.md invariant #5). Returns the
  // created observation so callers (e.g. the timing screen's per-lane "Finished" lock) can later
  // retract it via retractObservation without a round-trip.
  async recordObservation(input: NewObservation): Promise<Observation> {
    const now = new Date().toISOString();
    const observation: Observation = {
      id: crypto.randomUUID(),
      physicalLaneId: input.physicalLaneId,
      coachId: input.coachId,
      finalTimeMs: input.finalTimeMs,
      source: input.source,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    };
    const splits: Split[] = (input.splits ?? []).map((s) => ({
      id: crypto.randomUUID(),
      observationId: observation.id,
      splitNo: s.splitNo,
      splitMs: s.splitMs,
    }));

    await this.db.observations.put(observation);
    if (splits.length) await this.db.splits.bulkPut(splits);
    this._observations.set([...this._observations(), observation]);
    this._splits.set([...this._splits(), ...splits]);

    try {
      await this.pushObservation(observation, splits);
    } catch (e) {
      // Recorded locally regardless — surface nothing further; a future sync engine retries this.
      console.error('Failed to sync observation to Supabase (kept locally):', e);
    }
    return observation;
  }

  // Corrections set `deleted`/`updated_at` on the observation's own row rather than hard-deleting
  // it (CLAUDE.md invariant #1) — used by the timing screen's per-lane "undo" after a mistaken Finish.
  async retractObservation(observationId: string): Promise<void> {
    const existing = this._observations().find((o) => o.id === observationId);
    if (!existing || existing.deleted) return;
    const updated: Observation = { ...existing, deleted: true, updatedAt: new Date().toISOString() };

    await this.db.observations.put(updated);
    this._observations.set(this._observations().map((o) => (o.id === observationId ? updated : o)));

    try {
      const { error } = await this.supabase
        .from('observations')
        .update({ deleted: true, updated_at: updated.updatedAt })
        .eq('id', observationId);
      if (error) throw new Error(`observations: ${error.message}`);
    } catch (e) {
      console.error('Failed to sync observation retraction to Supabase (kept locally):', e);
    }
  }

  private async pushObservation(observation: Observation, splits: Split[]): Promise<void> {
    const { error } = await this.supabase.from('observations').insert({
      id: observation.id,
      physical_lane_id: observation.physicalLaneId,
      coach_id: observation.coachId,
      final_time_ms: observation.finalTimeMs,
      source: observation.source,
    });
    if (error) throw new Error(`observations: ${error.message}`);
    if (!splits.length) return;
    const { error: splitsError } = await this.supabase.from('splits').insert(
      splits.map((s) => ({
        id: s.id,
        observation_id: s.observationId,
        split_no: s.splitNo,
        split_ms: s.splitMs,
      }))
    );
    if (splitsError) throw new Error(`splits: ${splitsError.message}`);
  }

  // Workflow status only (pending -> in_progress -> completed as a heat is timed) — not a
  // structural edit, so RLS lets any signed-in coach write it (physical_heats_status_update), not
  // just Scorer/head-coach. Write-through rather than local-first: an optimistic local update that
  // then got rejected server-side would leave one coach's device showing a status no one else
  // agrees with, with no realtime event to self-correct it.
  async updateHeatStatus(heatId: string, status: PhysicalHeatStatus): Promise<void> {
    const { error } = await this.supabase.from('physical_heats').update({ status }).eq('id', heatId);
    if (error) throw new Error(`physical_heats: ${error.message}`);
    const updated = this._physicalHeats().map((h) => (h.id === heatId ? { ...h, status } : h));
    this._physicalHeats.set(updated);
    const heat = updated.find((h) => h.id === heatId);
    if (heat) await this.db.physicalHeats.put(heat);
  }

  // Best-effort auto transition (Start All -> in_progress, all lanes finished -> completed) —
  // failures are swallowed so a normal timing flow never surfaces an error to the coach; a Scorer's
  // manual override or another coach's device will catch the status up.
  async autoUpdateHeatStatus(heatId: string, status: PhysicalHeatStatus): Promise<void> {
    try {
      await this.updateHeatStatus(heatId, status);
    } catch (e) {
      console.error('Failed to auto-update heat status (kept local state as-is):', e);
    }
  }

  // Scorer/head-coach force-complete or reopen (CLAUDE.md invariant #4: structural/manual
  // corrections to live state must be written to activity_log).
  async setHeatStatusByScorer(
    heatId: string,
    status: PhysicalHeatStatus,
    coachId: string | null,
    action: string
  ): Promise<void> {
    await this.updateHeatStatus(heatId, status);
    await this.logActivity(heatId, coachId, action);
  }

  private async logActivity(
    physicalHeatId: string,
    coachId: string | null,
    action: string
  ): Promise<void> {
    const meetId = this._meet()?.id;
    if (!meetId) return;
    const { error } = await this.supabase
      .from('activity_log')
      .insert({ meet_id: meetId, coach_id: coachId, action, payload: { physical_heat_id: physicalHeatId } });
    if (error) console.error('Failed to log activity:', error);
  }

  // Coaches can have more than one meet live/published at once (e.g. parallel age-group
  // championships) — every candidate is loaded so selectMeet() can switch between them without a
  // re-query; resolveSelectedMeetId() picks which one is active by default. Falls back to the
  // locally cached list on failure (e.g. a hard page reload with no connectivity) rather than
  // failing `load()` outright — a coach who already has this meet's program cached shouldn't see
  // an error page just because the tiny "which meets exist" query couldn't reach the server.
  private async fetchAvailableMeets(): Promise<Meet[]> {
    try {
      const res = await this.supabase
        .from('meets')
        .select('*')
        .in('status', ['live', 'published'])
        .order('start_date', { ascending: true });
      if (res.error) throw new Error(`meets: ${res.error.message}`);
      const meets = (res.data ?? []).map(mapMeet);
      if (meets.length) await this.db.meets.bulkPut(meets);
      return meets;
    } catch (e) {
      const cached = await this.loadCachedMeets();
      if (cached.length === 0) throw e;
      console.error('Failed to fetch meets from Supabase (using cached list):', e);
      return cached;
    }
  }

  private async loadCachedMeets(): Promise<Meet[]> {
    const all = await this.db.meets.toArray();
    return all
      .filter((m) => m.status === 'live' || m.status === 'published')
      .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
  }

  // IndexedDB now holds every cached meet's rows at once (coaches can switch between two live
  // meets), but most of these tables have no direct meetId column — so unlike a plain `.where(...)`
  // lookup, most of this has to cascade-filter down from events/physicalHeats (which do) through
  // the FK chain, or a switch would leak another meet's heats/lanes/observations into view.
  private async loadFromCache(meetId: string): Promise<void> {
    const [events, physicalHeats, teams, swimmers, pointsTables, pointsRows] = await Promise.all([
      this.db.events.where('meetId').equals(meetId).toArray(),
      this.db.physicalHeats.where('meetId').equals(meetId).toArray(),
      this.db.teams.toArray(),
      this.db.swimmers.toArray(),
      this.db.pointsTables.toArray(),
      this.db.pointsRows.toArray(),
    ]);
    const eventIds = new Set(events.map((e) => e.id));
    const heatIds = new Set(physicalHeats.map((h) => h.id));

    const [allScheduledHeats, allPhysicalHeatSources, allPhysicalLanes] = await Promise.all([
      this.db.scheduledHeats.toArray(),
      this.db.physicalHeatSources.toArray(),
      this.db.physicalLanes.toArray(),
    ]);
    const scheduledHeats = allScheduledHeats.filter((h) => eventIds.has(h.eventId));
    const physicalHeatSources = allPhysicalHeatSources.filter((s) => heatIds.has(s.physicalHeatId));
    const physicalLanes = allPhysicalLanes.filter((l) => heatIds.has(l.physicalHeatId));
    const laneIds = new Set(physicalLanes.map((l) => l.id));

    const [allObservations, allSplits] = await Promise.all([
      this.db.observations.toArray(),
      this.db.splits.toArray(),
    ]);
    const observations = allObservations.filter((o) => laneIds.has(o.physicalLaneId));
    const observationIds = new Set(observations.map((o) => o.id));
    const splits = allSplits.filter((s) => observationIds.has(s.observationId));

    this._events.set(events);
    this._scheduledHeats.set(scheduledHeats);
    this._physicalHeats.set(physicalHeats);
    this._physicalHeatSources.set(physicalHeatSources);
    this._physicalLanes.set(physicalLanes);
    this._teams.set(teams);
    this._swimmers.set(swimmers);
    this._observations.set(observations);
    this._splits.set(splits);
    this._pointsTables.set(pointsTables);
    this._pointsRows.set(pointsRows);
  }

  // The "printed program" + structural state: fetched once per meet (see loadMeet) and again
  // only on an explicit hardRefresh(), rather than on every load() — this used to run
  // unconditionally on every load/selectMeet, including a full unscoped refetch of every team and
  // swimmer across every meet, which was the app's main source of slowness (docs/perf-sync-plan.md).
  private async syncProgramData(meetId: string): Promise<void> {
    const events = await this.fetchAndCache('events', mapEvent, this.db.events, (q) =>
      q.eq('meet_id', meetId)
    );
    const eventIds = events.map((e) => e.id);
    const physicalHeats = await this.fetchAndCache(
      'physical_heats',
      mapPhysicalHeat,
      this.db.physicalHeats,
      (q) => q.eq('meet_id', meetId)
    );
    const physicalHeatIds = physicalHeats.map((h) => h.id);
    await this.fetchAndCacheByIds(
      'scheduled_heats',
      'event_id',
      eventIds,
      mapScheduledHeat,
      this.db.scheduledHeats
    );
    await this.fetchAndCacheByIds(
      'physical_heat_sources',
      'physical_heat_id',
      physicalHeatIds,
      mapPhysicalHeatSource,
      this.db.physicalHeatSources,
      undefined,
      ['physical_heat_id', 'scheduled_heat_id']
    );
    await this.fetchAndCacheByIds(
      'physical_lanes',
      'physical_heat_id',
      physicalHeatIds,
      mapPhysicalLane,
      this.db.physicalLanes
    );
    await this.fetchAndCache('teams', mapTeam, this.db.teams, (q) => q);
    await this.fetchAndCache('swimmers', mapSwimmer, this.db.swimmers, (q) => q);
    await this.fetchAndCache('points_tables', mapPointsTable, this.db.pointsTables, (q) => q);
    await this.fetchAndCache('points_rows', mapPointsRow, this.db.pointsRows, (q) => q, [
      'points_table_id',
      'place',
    ]);

    const syncedAt = new Date().toISOString();
    await this.updateSyncMeta(meetId, { programSyncedAt: syncedAt });
    this._lastSyncedAt.set(syncedAt);
  }

  // The append-only timing data: still fetched on every load()/selectMeet() (unlike
  // syncProgramData) because it's what catches a device up on observations recorded by other
  // coaches while this device was closed — bounded to what's actually changed, so it stays cheap.
  // The Realtime subscription (subscribeRealtime) takes over for the rest of the session.
  //
  // Incremental, not a full refetch: observations are append-only (CLAUDE.md invariant #1) and a
  // retraction only ever bumps that same row's `updated_at` — so a `since` high-water mark per
  // meet (syncMeta.liveDataSyncedAt) is enough to ask the server for only what changed, merged
  // into the existing cache/signal rather than replacing it outright (unlike fetchAndCacheByIds,
  // which assumes its result is the complete set).
  //
  // Deliberately NOT scoped by this meet's lane ids: RLS's `observations_select` policy already
  // grants every signed-in coach read access to every observation regardless of meet (see
  // supabase/migrations/20260714000002_rls.sql), so chunking by lane id bought no security — only
  // cost, one request per ~150 lanes even when nothing had changed (a multi-thousand-lane meet
  // meant 20-60+ requests on every single load just to hear back "nothing new"). Fetching by
  // `since` alone makes the request count track how much actually changed, not how big the meet's
  // program is; rows belonging to some other meet are simply filtered out below before merging.
  //
  // Splits never change after creation and are always inserted alongside their observation, so
  // they only need fetching for observation ids that came back in *this round's* delta — no
  // separate `since` tracking for them, and the id list is small enough that chunking-by-id (via
  // fetchRowsByIds) is the right call here, unlike for observations above.
  private async syncLiveData(meetId: string): Promise<void> {
    const laneIds = new Set(this._physicalLanes().map((l) => l.id));
    const since = (await this.db.syncMeta.get(meetId))?.liveDataSyncedAt ?? EPOCH;

    const changed = await this.fetchRows(
      'observations',
      mapObservation,
      (q) => q.gte('updated_at', since),
      ['updated_at']
    );
    const observations = changed.filter((o) => laneIds.has(o.physicalLaneId));
    await this.mergeIntoCache(this.db.observations, this._observations, observations);

    const observationIds = observations.map((o) => o.id);
    const splits = await this.fetchRowsByIds('splits', 'observation_id', observationIds, mapSplit);
    await this.mergeIntoCache(this.db.splits, this._splits, splits);

    const latest = changed.reduce((max, o) => (o.updatedAt > max ? o.updatedAt : max), since);
    if (latest !== since) await this.updateSyncMeta(meetId, { liveDataSyncedAt: latest });
  }

  // Hard-refresh only. syncLiveData's `since` merge only ever adds/updates rows, so it can never
  // notice a server-side deletion (e.g. wiping test observations before a meet goes live) — the
  // stale rows just stay cached forever. This instead refetches every observation/split for the
  // meet's current lanes and prunes whatever's no longer in that set, in both IndexedDB and the
  // signal, then resets the incremental high-water mark so syncLiveData resumes cleanly from here.
  // Results aren't synced separately — the Results tab computes them client-side from
  // observations, so this covers both.
  private async fullResyncLiveData(meetId: string): Promise<void> {
    const laneIds = this._physicalLanes().map((l) => l.id);
    const observations = await this.fetchRowsByIds(
      'observations',
      'physical_lane_id',
      laneIds,
      mapObservation
    );
    await this.replaceScopedCache(this.db.observations, this._observations, observations, (o) =>
      laneIds.includes(o.physicalLaneId)
    );

    const observationIds = observations.map((o) => o.id);
    const splits = await this.fetchRowsByIds('splits', 'observation_id', observationIds, mapSplit);
    await this.replaceScopedCache(this.db.splits, this._splits, splits, (s) =>
      observationIds.includes(s.observationId)
    );

    const latest = observations.reduce((max, o) => (o.updatedAt > max ? o.updatedAt : max), EPOCH);
    await this.updateSyncMeta(meetId, { liveDataSyncedAt: latest });
  }

  // Partial update of a meet's syncMeta row — read-modify-write rather than a raw `put`, since
  // programSyncedAt and liveDataSyncedAt are set independently (syncProgramData vs syncLiveData)
  // and a `put` would silently blow away whichever field isn't part of this call's `changes`.
  private async updateSyncMeta(
    meetId: string,
    changes: Partial<Omit<SyncMeta, 'meetId'>>
  ): Promise<void> {
    const existing = await this.db.syncMeta.get(meetId);
    await this.db.syncMeta.put({
      meetId,
      programSyncedAt: existing?.programSyncedAt ?? null,
      liveDataSyncedAt: existing?.liveDataSyncedAt ?? null,
      ...changes,
    });
  }

  // Upserts by id into both IndexedDB and the in-memory signal without discarding whatever the
  // signal already held (unlike fetchAndCache/fetchAndCacheByIds's `sig.set(rows)`, which replaces
  // wholesale and is only correct when `rows` is the complete result set) — used by syncLiveData's
  // incremental fetch, where `rows` is just this round's delta.
  private async mergeIntoCache<T extends { id: string }>(
    dexieTable: { bulkPut: (items: T[]) => Promise<any> },
    sig: ReturnType<typeof signal<T[]>>,
    rows: T[]
  ): Promise<void> {
    if (rows.length === 0) return;
    await dexieTable.bulkPut(rows);
    const byId = new Map(sig().map((item) => [item.id, item]));
    for (const row of rows) byId.set(row.id, row);
    sig.set([...byId.values()]);
  }

  // Wholesale replace, scoped: unlike mergeIntoCache, this treats `rows` as the complete server
  // truth for whatever `belongsToScope` covers (e.g. "this meet's lanes") and prunes local rows in
  // that scope that no longer exist server-side — mergeIntoCache can only add/update, never notice
  // a deletion. Used by fullResyncLiveData (hard refresh); the normal incremental sync path doesn't
  // need this because it never has to reconcile deletions mid-session.
  private async replaceScopedCache<T extends { id: string }>(
    dexieTable: {
      bulkPut: (items: T[]) => Promise<any>;
      toArray: () => Promise<T[]>;
      bulkDelete: (ids: string[]) => Promise<any>;
    },
    sig: ReturnType<typeof signal<T[]>>,
    rows: T[],
    belongsToScope: (item: T) => boolean
  ): Promise<void> {
    const freshIds = new Set(rows.map((r) => r.id));
    const staleIds = (await dexieTable.toArray())
      .filter((item) => belongsToScope(item) && !freshIds.has(item.id))
      .map((item) => item.id);
    if (staleIds.length) await dexieTable.bulkDelete(staleIds);
    if (rows.length) await dexieTable.bulkPut(rows);
    sig.set(rows);
  }

  private readonly signalByTable: Record<string, ReturnType<typeof signal<any[]>>> = {
    events: this._events,
    scheduled_heats: this._scheduledHeats,
    physical_heats: this._physicalHeats,
    physical_heat_sources: this._physicalHeatSources,
    physical_lanes: this._physicalLanes,
    teams: this._teams,
    swimmers: this._swimmers,
    observations: this._observations,
    splits: this._splits,
    points_tables: this._pointsTables,
    points_rows: this._pointsRows,
  };

  // The shared paginated-fetch primitive: pages through `filter`'s query in FETCH_PAGE_SIZE chunks,
  // advancing by however many rows actually came back rather than assuming the request size was
  // honored — a page smaller than requested could mean "that's everything" or "the server's
  // configured cap is lower than FETCH_PAGE_SIZE," and only an empty page distinguishes "done" from
  // either of those. orderColumns keeps page boundaries stable across requests — defaults to the
  // synthetic `id` PK every table but points_rows/physical_heat_sources have (composite PKs), see
  // those call sites. No side effects (no Dexie/signal writes) — callers decide replace vs. merge.
  private async fetchRows<T>(
    table: string,
    mapper: (row: any) => T,
    filter: (q: any) => any,
    orderColumns: string[] = ['id']
  ): Promise<T[]> {
    const rows: T[] = [];
    let from = 0;
    for (;;) {
      let query = filter(this.supabase.from(table).select('*'));
      for (const column of orderColumns) query = query.order(column, { ascending: true });
      const res = await query.range(from, from + FETCH_PAGE_SIZE - 1);
      if (res.error) throw new Error(`${table}: ${res.error.message}`);
      const page: T[] = (res.data ?? []).map(mapper);
      if (page.length === 0) break;
      rows.push(...page);
      from += page.length;
    }
    return rows;
  }

  // teams/swimmers aren't meet-scoped (ADR-7), so this fetches every row across every meet in one
  // go — with two full meets seeded that's now high enough to hit PostgREST's default row cap
  // (commonly 1000), which clips silently with no error; fetchRows's pagination handles that.
  private async fetchAndCache<T>(
    table: string,
    mapper: (row: any) => T,
    dexieTable: { bulkPut: (items: T[]) => Promise<any> },
    filter: (q: any) => any,
    orderColumns: string[] = ['id']
  ): Promise<T[]> {
    const rows = await this.fetchRows(table, mapper, filter, orderColumns);
    if (rows.length) await dexieTable.bulkPut(rows);
    this.signalByTable[table]?.set(rows);
    return rows;
  }

  // Same as fetchAndCache, but for `.in(column, ids)` lookups where `ids` can be large (this meet's
  // seed data has thousands of physical_lanes). PostgREST serializes `.in()` values into the
  // request URL, and an unbatched list that size blows past URL-length limits and comes back as a
  // 400 — so this splits the id list into chunks, one fetchRows call (itself paginated) per chunk.
  // Only use this for tables genuinely too big to fetch unscoped — see syncLiveData's observations
  // fetch for why chunking-by-id isn't always the right call: it makes request count scale with
  // the id list's size (i.e. the meet's total lane count) rather than with how much data actually
  // matches the filter, which is backwards for a query that's usually filtering down to "what's new".
  private async fetchAndCacheByIds<T>(
    table: string,
    column: string,
    ids: string[],
    mapper: (row: any) => T,
    dexieTable: { bulkPut: (items: T[]) => Promise<any> },
    extraFilter?: (q: any) => any,
    orderColumns: string[] = ['id']
  ): Promise<T[]> {
    const rows = await this.fetchRowsByIds(table, column, ids, mapper, extraFilter, orderColumns);
    if (rows.length) await dexieTable.bulkPut(rows);
    this.signalByTable[table]?.set(rows);
    return rows;
  }

  // The chunked/paginated `.in(column, ids)` fetch itself, without fetchAndCacheByIds's "replace
  // the whole signal" side effect.
  private async fetchRowsByIds<T>(
    table: string,
    column: string,
    ids: string[],
    mapper: (row: any) => T,
    extraFilter?: (q: any) => any,
    orderColumns: string[] = ['id']
  ): Promise<T[]> {
    if (ids.length === 0) return [];
    const rows: T[] = [];
    for (const idsChunk of chunk(ids, ID_CHUNK_SIZE)) {
      const page = await this.fetchRows(
        table,
        mapper,
        (q) => (extraFilter ? extraFilter(q.in(column, idsChunk)) : q.in(column, idsChunk)),
        orderColumns
      );
      rows.push(...page);
    }
    return rows;
  }

  // physical_lanes/observations/splits have no meet_id column to filter on server-side, so with
  // two meets' data both cached at once, a change on the *other* meet would otherwise land in this
  // meet's signals too — each handler below checks the change's parent still belongs to this meet
  // (via the already-scoped signals) before applying it.
  private subscribeRealtime(meetId: string): void {
    this.realtimeChannel?.unsubscribe();
    this.realtimeChannel = this.supabase
      .channel(`meet-data:${meetId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'physical_heats', filter: `meet_id=eq.${meetId}` },
        (payload) => this.applyRealtimeChange(this.db.physicalHeats, this._physicalHeats, mapPhysicalHeat, payload)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'physical_lanes' },
        (payload) => {
          const row = (payload.new ?? payload.old) as any;
          if (this._physicalHeats().some((h) => h.id === row?.physical_heat_id)) {
            this.applyRealtimeChange(this.db.physicalLanes, this._physicalLanes, mapPhysicalLane, payload);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'observations' },
        (payload) => {
          const row = (payload.new ?? payload.old) as any;
          if (this._physicalLanes().some((l) => l.id === row?.physical_lane_id)) {
            this.applyRealtimeChange(this.db.observations, this._observations, mapObservation, payload);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'splits' },
        (payload) => {
          const row = (payload.new ?? payload.old) as any;
          if (this._observations().some((o) => o.id === row?.observation_id)) {
            this.applyRealtimeChange(this.db.splits, this._splits, mapSplit, payload);
          }
        }
      )
      .subscribe();
  }

  private applyRealtimeChange<T extends { id: string }>(
    dexieTable: { put: (item: T) => Promise<any>; delete: (id: string) => Promise<any> },
    sig: ReturnType<typeof signal<T[]>>,
    mapper: (row: any) => T,
    payload: { eventType: string; new: any; old: any }
  ): void {
    if (payload.eventType === 'DELETE') {
      const id = payload.old.id as string;
      dexieTable.delete(id);
      sig.set(sig().filter((item) => item.id !== id));
      return;
    }
    const mapped = mapper(payload.new);
    dexieTable.put(mapped);
    sig.set([...sig().filter((item) => item.id !== mapped.id), mapped]);
  }
}
