import { Injectable, computed, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import { LocalDbService } from './local-db.service';
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
    await this.refreshFromSupabase(meetId);
    this.subscribeRealtime(meetId);
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
  // re-query; resolveSelectedMeetId() picks which one is active by default.
  private async fetchAvailableMeets(): Promise<Meet[]> {
    const res = await this.supabase
      .from('meets')
      .select('*')
      .in('status', ['live', 'published'])
      .order('start_date', { ascending: true });
    if (res.error) throw new Error(`meets: ${res.error.message}`);
    return (res.data ?? []).map(mapMeet);
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

  private async refreshFromSupabase(meetId: string): Promise<void> {
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
    const physicalLanes = await this.fetchAndCacheByIds(
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

    const laneIds = physicalLanes.map((l) => l.id);
    const observations = await this.fetchAndCacheByIds(
      'observations',
      'physical_lane_id',
      laneIds,
      mapObservation,
      this.db.observations,
      (q) => q.eq('deleted', false)
    );
    const observationIds = observations.map((o) => o.id);
    await this.fetchAndCacheByIds(
      'splits',
      'observation_id',
      observationIds,
      mapSplit,
      this.db.splits
    );
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

  // teams/swimmers aren't meet-scoped (ADR-7), so this fetches every row across every meet in one
  // go — with two full meets seeded that's now high enough to hit PostgREST's default row cap
  // (commonly 1000), which clips silently with no error. .range() pages through in FETCH_PAGE_SIZE
  // chunks, advancing by however many rows actually came back rather than assuming the request size
  // was honored — a page smaller than requested could mean "that's everything" or "the server's
  // configured cap is lower than FETCH_PAGE_SIZE," and only an empty page distinguishes "done" from
  // either of those. orderColumns keeps page boundaries stable across requests — defaults to the
  // synthetic `id` PK every table but points_rows has (its PK is the composite (points_table_id,
  // place), see the points_rows call site below).
  private async fetchAndCache<T>(
    table: string,
    mapper: (row: any) => T,
    dexieTable: { bulkPut: (items: T[]) => Promise<any> },
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
    if (rows.length) await dexieTable.bulkPut(rows);
    this.signalByTable[table]?.set(rows);
    return rows;
  }

  // Same as fetchAndCache, but for `.in(column, ids)` lookups where `ids` can be large (this meet's
  // seed data has 700+ physical_lanes). PostgREST serializes `.in()` values into the request URL,
  // and an unbatched list that size blows past URL-length limits and comes back as a 400 — so this
  // splits the id list into chunks. But chunking alone isn't enough: a single chunk's *result set*
  // can still exceed PostgREST's default row cap (e.g. 150 physical_heat_ids at ~7 lanes each is
  // ~1000+ rows) and get silently truncated the same way an unranged fetchAndCache would — so each
  // chunk is itself paginated via .range(), same as fetchAndCache. orderColumns defaults to `id`,
  // but physical_heat_sources has no `id` column (composite PK) — see that call site.
  private async fetchAndCacheByIds<T>(
    table: string,
    column: string,
    ids: string[],
    mapper: (row: any) => T,
    dexieTable: { bulkPut: (items: T[]) => Promise<any> },
    extraFilter?: (q: any) => any,
    orderColumns: string[] = ['id']
  ): Promise<T[]> {
    if (ids.length === 0) {
      this.signalByTable[table]?.set([]);
      return [];
    }
    const rows: T[] = [];
    for (const idsChunk of chunk(ids, ID_CHUNK_SIZE)) {
      let from = 0;
      for (;;) {
        let query = this.supabase.from(table).select('*').in(column, idsChunk);
        if (extraFilter) query = extraFilter(query);
        for (const orderColumn of orderColumns) query = query.order(orderColumn, { ascending: true });
        const res = await query.range(from, from + FETCH_PAGE_SIZE - 1);
        if (res.error) throw new Error(`${table}: ${res.error.message}`);
        const page: T[] = (res.data ?? []).map(mapper);
        if (page.length === 0) break;
        rows.push(...page);
        from += page.length;
      }
    }
    if (rows.length) await dexieTable.bulkPut(rows);
    this.signalByTable[table]?.set(rows);
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
