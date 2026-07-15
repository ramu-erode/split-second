import { Observation, PhysicalLane, Swimmer, Team } from '../../core/models/domain.models';
import { LaneSession, emptyLaneSession } from './lane-session.model';
import { LaneRowViewModel, ObservationSummary } from './lane-row/lane-row.model';

export function buildLaneRowViewModels(
  lanes: PhysicalLane[],
  observationsByLaneId: Map<string, Observation[]>,
  teamsById: Map<string, Team>,
  swimmersById: Map<string, Swimmer>,
  currentCoachId: string | null,
  sessionsByLaneId: Map<string, LaneSession>,
  selectedLaneIds: Set<string>
): LaneRowViewModel[] {
  return lanes
    .slice()
    .sort((a, b) => a.laneNo - b.laneNo)
    .map((lane) =>
      toLaneRowViewModel(
        lane,
        observationsByLaneId,
        teamsById,
        swimmersById,
        currentCoachId,
        sessionsByLaneId.get(lane.id) ?? emptyLaneSession(),
        selectedLaneIds.has(lane.id)
      )
    );
}

function toLaneRowViewModel(
  lane: PhysicalLane,
  observationsByLaneId: Map<string, Observation[]>,
  teamsById: Map<string, Team>,
  swimmersById: Map<string, Swimmer>,
  currentCoachId: string | null,
  session: LaneSession,
  isSelected: boolean
): LaneRowViewModel {
  const team = lane.teamId ? teamsById.get(lane.teamId) : undefined;
  const swimmer = lane.swimmerId ? swimmersById.get(lane.swimmerId) : undefined;
  const observations = (observationsByLaneId.get(lane.id) ?? [])
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((o) => toObservationSummary(o, currentCoachId));
  return {
    laneId: lane.id,
    laneNo: lane.laneNo,
    swimmerName: swimmer?.name ?? null,
    teamName: team?.name ?? null,
    seedTimeMs: lane.seedTimeMs,
    isMyTeam: team?.isMyTeam ?? false,
    status: lane.status,
    observations,
    splits: session.splits,
    isFinished: session.finishedObservationId != null,
    finishedFinalTimeMs: session.finishedFinalTimeMs,
    isSelected,
  };
}

function toObservationSummary(
  observation: Observation,
  currentCoachId: string | null
): ObservationSummary {
  return {
    id: observation.id,
    finalTimeMs: observation.finalTimeMs,
    source: observation.source,
    isMine: observation.coachId === currentCoachId,
  };
}
