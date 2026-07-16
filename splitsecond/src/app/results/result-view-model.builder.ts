import {
  Event,
  Observation,
  PhysicalLane,
  PointsRow,
  Split,
  Swimmer,
  Team,
} from '../core/models/domain.models';
import { LaneResult, computeEventScoring } from '../leaderboard/results-calculator';
import { formatEventTitle } from '../order-of-events/upcoming/heat-view-model.builder';
import { EventResultsViewModel, ResultViewModel, TeamOption } from './result.model';

// Team wise / group wise / event wise / gender wise / swimmer wise completed results, built on top
// of the same local scoring engine the leaderboard uses (ADR-8) — an event only appears here once
// it has at least one completed (timed) lane, and only completed lanes are included.
export function buildEventResults(
  events: Event[],
  lanesByEventId: Map<string, PhysicalLane[]>,
  observationsByLaneId: Map<string, Observation[]>,
  splitsByObservationId: Map<string, Split[]>,
  pointsRowsByTableId: Map<string, PointsRow[]>,
  teamsById: Map<string, Team>,
  swimmersById: Map<string, Swimmer>
): EventResultsViewModel[] {
  const out: EventResultsViewModel[] = [];
  for (const event of events) {
    const lanes = lanesByEventId.get(event.id) ?? [];
    const pointsRows = event.pointsTableId ? (pointsRowsByTableId.get(event.pointsTableId) ?? []) : [];
    const scoring = computeEventScoring(event.id, lanes, observationsByLaneId, pointsRows);
    if (!scoring || scoring.results.length === 0) continue;

    const lanesById = new Map(lanes.map((l) => [l.id, l]));
    const results = scoring.results
      .slice()
      .sort((a, b) => a.place - b.place)
      .map((r) =>
        toResultViewModel(
          r,
          lanesById.get(r.physicalLaneId),
          observationsByLaneId,
          splitsByObservationId,
          teamsById,
          swimmersById
        )
      );

    out.push({
      eventId: event.id,
      eventNo: event.eventNo,
      eventTitle: formatEventTitle(event),
      ageGroup: event.ageGroup,
      gender: event.gender,
      isRelay: event.isRelay,
      isProvisional: scoring.isProvisional,
      results,
      firstCompletedAt: resolveFirstCompletedAt(lanes, observationsByLaneId),
    });
  }
  return out.sort((a, b) => a.eventNo - b.eventNo);
}

// The earliest `createdAt` among this event's timed observations — i.e. the moment the event
// first had "at least one swimmer's time recorded". Only called once `computeEventScoring` has
// already confirmed at least one lane resolved to a time, so an observation always exists here.
function resolveFirstCompletedAt(
  lanes: PhysicalLane[],
  observationsByLaneId: Map<string, Observation[]>
): string {
  let earliest: string | null = null;
  for (const lane of lanes) {
    for (const obs of observationsByLaneId.get(lane.id) ?? []) {
      if (obs.finalTimeMs == null) continue;
      if (earliest == null || obs.createdAt < earliest) earliest = obs.createdAt;
    }
  }
  return earliest as string;
}

function toResultViewModel(
  result: LaneResult,
  lane: PhysicalLane | undefined,
  observationsByLaneId: Map<string, Observation[]>,
  splitsByObservationId: Map<string, Split[]>,
  teamsById: Map<string, Team>,
  swimmersById: Map<string, Swimmer>
): ResultViewModel {
  const team = result.teamId ? teamsById.get(result.teamId) : undefined;
  const swimmer = lane?.swimmerId ? swimmersById.get(lane.swimmerId) : undefined;
  const seedTimeMs = lane?.seedTimeMs ?? null;
  return {
    physicalLaneId: result.physicalLaneId,
    place: result.place,
    swimmerName: swimmer?.name ?? null,
    teamId: result.teamId,
    teamName: team?.name ?? 'Unknown team',
    isMyTeam: team?.isMyTeam ?? false,
    timeMs: result.timeMs,
    points: result.points,
    seedTimeMs,
    deltaMs: seedTimeMs != null ? result.timeMs - seedTimeMs : null,
    splits: lane ? resolveSplits(lane.id, observationsByLaneId, splitsByObservationId) : [],
  };
}

// A lane's official time can be an average of several stopwatch observations
// (results-calculator.ts's resolveLaneTime), so there's no single "the" observation to point at in
// that case. This shows whichever finished observation was recorded/updated most recently — a
// reasonable approximation for a coach's quick reference, not used for the time/points above.
function resolveSplits(
  laneId: string,
  observationsByLaneId: Map<string, Observation[]>,
  splitsByObservationId: Map<string, Split[]>
): number[] {
  const latest = (observationsByLaneId.get(laneId) ?? [])
    .filter((o) => o.finalTimeMs != null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!latest) return [];
  return (splitsByObservationId.get(latest.id) ?? [])
    .slice()
    .sort((a, b) => a.splitNo - b.splitNo)
    .map((s) => s.splitMs);
}

export function distinctTeams(
  eventResults: EventResultsViewModel[],
  teamsById: Map<string, Team>
): TeamOption[] {
  const ids = new Set<string>();
  for (const e of eventResults) {
    for (const r of e.results) if (r.teamId) ids.add(r.teamId);
  }
  return [...ids]
    .map((id) => ({ id, name: teamsById.get(id)?.name ?? 'Unknown team' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function distinctAgeGroups(eventResults: EventResultsViewModel[]): string[] {
  const set = new Set<string>();
  for (const e of eventResults) if (e.ageGroup) set.add(e.ageGroup);
  return [...set].sort();
}

export function distinctGenders(eventResults: EventResultsViewModel[]): string[] {
  const set = new Set<string>();
  for (const e of eventResults) set.add(e.gender);
  return [...set].sort();
}

export interface ResultsFilter {
  teamId: string | null;
  ageGroup: string | null;
  gender: string | null;
}

export function filterEventResults(
  eventResults: EventResultsViewModel[],
  filter: ResultsFilter
): EventResultsViewModel[] {
  return eventResults
    .map((e) => {
      if (filter.ageGroup && e.ageGroup !== filter.ageGroup) return null;
      if (filter.gender && e.gender !== filter.gender) return null;
      const results = filter.teamId ? e.results.filter((r) => r.teamId === filter.teamId) : e.results;
      if (results.length === 0) return null;
      return { ...e, results };
    })
    .filter((e): e is EventResultsViewModel => e !== null);
}
