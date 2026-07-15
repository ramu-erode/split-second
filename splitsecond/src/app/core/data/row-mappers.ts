// Supabase/Postgres rows are snake_case; domain models (core/models) are camelCase.
// Each mapper takes the raw row shape returned by supabase-js and returns a typed domain model.

import {
  Coach,
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

export function mapCoach(row: any): Coach {
  return {
    id: row.id,
    teamId: row.team_id,
    displayName: row.display_name,
    canScore: row.can_score,
    createdAt: row.created_at,
  };
}

export function mapTeam(row: any): Team {
  return { id: row.id, name: row.name, isMyTeam: row.is_my_team, createdAt: row.created_at };
}

export function mapSwimmer(row: any): Swimmer {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    externalRef: row.external_ref,
    birthYear: row.birth_year,
    gender: row.gender,
    createdAt: row.created_at,
  };
}

export function mapMeet(row: any): Meet {
  return {
    id: row.id,
    name: row.name,
    venue: row.venue,
    startDate: row.start_date,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapEvent(row: any): Event {
  return {
    id: row.id,
    meetId: row.meet_id,
    eventNo: row.event_no,
    name: row.name,
    distanceM: row.distance_m,
    stroke: row.stroke,
    gender: row.gender,
    ageGroup: row.age_group,
    isRelay: row.is_relay,
    pointsTableId: row.points_table_id,
  };
}

export function mapScheduledHeat(row: any): ScheduledHeat {
  return {
    id: row.id,
    eventId: row.event_id,
    heatNo: row.heat_no,
    sourceFileId: row.source_file_id,
    sourcePage: row.source_page,
  };
}

export function mapPhysicalHeat(row: any): PhysicalHeat {
  return {
    id: row.id,
    meetId: row.meet_id,
    label: row.label,
    startAt: row.start_at,
    status: row.status,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
  };
}

export function mapPhysicalHeatSource(row: any): PhysicalHeatSource {
  return { physicalHeatId: row.physical_heat_id, scheduledHeatId: row.scheduled_heat_id };
}

export function mapPhysicalLane(row: any): PhysicalLane {
  return {
    id: row.id,
    physicalHeatId: row.physical_heat_id,
    laneNo: row.lane_no,
    swimmerId: row.swimmer_id,
    teamId: row.team_id,
    eventId: row.event_id,
    gender: row.gender,
    ageGroup: row.age_group,
    status: row.status,
    sourceScheduledLaneId: row.source_scheduled_lane_id,
    seedTimeMs: row.seed_time_ms,
  };
}

export function mapObservation(row: any): Observation {
  return {
    id: row.id,
    physicalLaneId: row.physical_lane_id,
    coachId: row.coach_id,
    finalTimeMs: row.final_time_ms,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deleted: row.deleted,
  };
}

export function mapSplit(row: any): Split {
  return {
    id: row.id,
    observationId: row.observation_id,
    splitNo: row.split_no,
    splitMs: row.split_ms,
  };
}

export function mapPointsTable(row: any): PointsTable {
  return { id: row.id, name: row.name };
}

export function mapPointsRow(row: any): PointsRow {
  return { pointsTableId: row.points_table_id, place: row.place, points: row.points };
}
