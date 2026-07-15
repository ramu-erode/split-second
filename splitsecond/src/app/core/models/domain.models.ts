// Domain models mirroring supabase/migrations schema (see docs/architecture.md §3).
// Field names are camelCase here; the data-access layer maps to/from Postgres snake_case.

export type Uuid = string;
export type IsoTimestamp = string;

// Identity -------------------------------------------------------------------------------------

export interface Team {
  id: Uuid;
  name: string;
  isMyTeam: boolean;
  createdAt: IsoTimestamp;
}

export interface Coach {
  id: Uuid; // = auth.users.id
  teamId: Uuid;
  displayName: string;
  canScore: boolean;
  createdAt: IsoTimestamp;
}

export interface Swimmer {
  id: Uuid;
  teamId: Uuid;
  name: string;
  externalRef: string | null;
  birthYear: number | null;
  gender: string | null;
  createdAt: IsoTimestamp;
}

// Meet & program (immutable after publish) ------------------------------------------------------

export type MeetStatus = 'draft' | 'published' | 'live' | 'done';

export interface Meet {
  id: Uuid;
  name: string;
  venue: string | null;
  startDate: string | null; // date, not timestamp
  status: MeetStatus;
  createdBy: Uuid | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type MeetSourceFileStatus = 'parsed' | 'needs_review' | 'merged';

export interface MeetSourceFile {
  id: Uuid;
  meetId: Uuid;
  filename: string;
  formatDetected: string | null;
  dayNo: number | null;
  session: string | null;
  uploadedBy: Uuid | null;
  uploadedAt: IsoTimestamp;
  status: MeetSourceFileStatus;
}

export interface PointsTable {
  id: Uuid;
  name: string;
}

export interface PointsRow {
  pointsTableId: Uuid;
  place: number;
  points: number;
}

export interface Event {
  id: Uuid;
  meetId: Uuid;
  eventNo: number;
  name: string;
  distanceM: number;
  stroke: string;
  gender: string; // free text — vocabulary differs by source (Men/Women vs Boys/Girls)
  ageGroup: string | null;
  isRelay: boolean;
  pointsTableId: Uuid | null;
}

export interface ScheduledHeat {
  id: Uuid;
  eventId: Uuid;
  heatNo: number;
  sourceFileId: Uuid | null;
  sourcePage: number | null;
}

export interface ScheduledLane {
  id: Uuid;
  scheduledHeatId: Uuid;
  laneNo: number;
  swimmerId: Uuid | null;
  teamId: Uuid | null;
  seedTimeMs: number | null;
}

// On-deck reality (auto-materialized 1:1 from scheduled_* at publish — ADR-10) -------------------

export type PhysicalHeatStatus = 'pending' | 'in_progress' | 'completed';

export interface PhysicalHeat {
  id: Uuid;
  meetId: Uuid;
  label: string | null;
  startAt: IsoTimestamp | null;
  status: PhysicalHeatStatus;
  createdBy: Uuid | null;
  updatedAt: IsoTimestamp;
}

export interface PhysicalHeatSource {
  physicalHeatId: Uuid;
  scheduledHeatId: Uuid;
}

export type PhysicalLaneStatus = 'seeded' | 'scratched' | 'no_show' | 'deck_entry';

export interface PhysicalLane {
  id: Uuid;
  physicalHeatId: Uuid;
  laneNo: number;
  swimmerId: Uuid | null; // null = unidentified deck entry
  teamId: Uuid | null;
  eventId: Uuid | null; // scoring category travels with the lane, not the heat
  gender: string | null;
  ageGroup: string | null;
  status: PhysicalLaneStatus;
  sourceScheduledLaneId: Uuid | null;
  seedTimeMs: number | null; // denormalized from scheduled_lanes at materialization (ADR-10)
}

// Live timing (append-only — CLAUDE.md invariant #1) ---------------------------------------------

export type ObservationSource = 'stopwatch' | 'manual';

export interface Observation {
  id: Uuid; // client-generated
  physicalLaneId: Uuid;
  coachId: Uuid;
  finalTimeMs: number | null;
  source: ObservationSource;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deleted: boolean;
}

export interface Split {
  id: Uuid; // client-generated
  observationId: Uuid;
  splitNo: number;
  splitMs: number;
}

// Scoring (materialized, recomputed on write — ADR-8) ---------------------------------------------

export interface Result {
  id: Uuid;
  eventId: Uuid;
  place: number | null;
  physicalLaneId: Uuid;
  timeMs: number | null;
  teamId: Uuid | null;
  points: number | null;
  isProvisional: boolean;
  computedAt: IsoTimestamp;
}

// Collaboration -----------------------------------------------------------------------------------

export interface ActivityLogEntry {
  id: Uuid;
  meetId: Uuid;
  coachId: Uuid | null;
  action: string;
  payload: Record<string, unknown> | null;
  createdAt: IsoTimestamp;
}

export interface LaneClaim {
  physicalLaneId: Uuid;
  coachId: Uuid;
  createdAt: IsoTimestamp;
}
