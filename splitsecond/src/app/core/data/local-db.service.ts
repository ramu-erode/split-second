import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import {
  Event,
  Meet,
  Observation,
  PhysicalHeat,
  PhysicalHeatSource,
  PhysicalLane,
  PointsRow,
  PointsTable,
  ScheduledHeat,
  Split,
  Swimmer,
  Team,
} from '../models/domain.models';

// Local IndexedDB cache. Order of Events reads from here first (offline-first — CLAUDE.md
// invariant #5); MeetDataStore is responsible for keeping it in sync with Supabase.
@Injectable({ providedIn: 'root' })
export class LocalDbService extends Dexie {
  readonly teams: Table<Team, string>;
  readonly swimmers: Table<Swimmer, string>;
  readonly meets: Table<Meet, string>;
  readonly events: Table<Event, string>;
  readonly scheduledHeats: Table<ScheduledHeat, string>;
  readonly physicalHeats: Table<PhysicalHeat, string>;
  readonly physicalHeatSources: Table<PhysicalHeatSource, [string, string]>;
  readonly physicalLanes: Table<PhysicalLane, string>;
  readonly observations: Table<Observation, string>;
  readonly splits: Table<Split, string>;
  readonly pointsTables: Table<PointsTable, string>;
  readonly pointsRows: Table<PointsRow, [string, number]>;

  constructor() {
    super('splitsecond');
    this.version(1).stores({
      teams: 'id',
      swimmers: 'id, teamId',
      meets: 'id, status',
      events: 'id, meetId, eventNo',
      scheduledHeats: 'id, eventId, heatNo',
      physicalHeats: 'id, meetId, status',
      physicalHeatSources: '[physicalHeatId+scheduledHeatId], physicalHeatId, scheduledHeatId',
      physicalLanes: 'id, physicalHeatId, eventId, swimmerId, teamId',
    });
    this.version(2).stores({
      observations: 'id, physicalLaneId, coachId, deleted',
      splits: 'id, observationId',
      pointsTables: 'id',
      pointsRows: '[pointsTableId+place], pointsTableId',
    });
    this.teams = this.table('teams');
    this.swimmers = this.table('swimmers');
    this.meets = this.table('meets');
    this.events = this.table('events');
    this.scheduledHeats = this.table('scheduledHeats');
    this.physicalHeats = this.table('physicalHeats');
    this.physicalHeatSources = this.table('physicalHeatSources');
    this.physicalLanes = this.table('physicalLanes');
    this.observations = this.table('observations');
    this.splits = this.table('splits');
    this.pointsTables = this.table('pointsTables');
    this.pointsRows = this.table('pointsRows');
  }
}
