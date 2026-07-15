import { Event, Observation, PhysicalLane, PointsRow, Team } from '../core/models/domain.models';
import { GroupStandingsViewModel } from './group-standings.model';
import { computeGroupedTeamStandings } from './results-calculator';
import { TeamStandingViewModel } from './standing-row/standing-row.model';

export function buildGroupStandings(
  events: Event[],
  lanesByEventId: Map<string, PhysicalLane[]>,
  observationsByLaneId: Map<string, Observation[]>,
  pointsRowsByTableId: Map<string, PointsRow[]>,
  teamsById: Map<string, Team>
): GroupStandingsViewModel[] {
  return computeGroupedTeamStandings(
    events,
    lanesByEventId,
    observationsByLaneId,
    pointsRowsByTableId
  ).map((group) => ({
    key: `${group.ageGroup ?? 'ungrouped'}|${group.gender}`,
    title: `${group.ageGroup ?? 'Ungrouped'} — ${group.gender}`,
    standings: group.standings.map((standing) => toStandingViewModel(standing, teamsById)),
  }));
}

function toStandingViewModel(
  standing: { teamId: string; points: number; isProvisional: boolean },
  teamsById: Map<string, Team>
): TeamStandingViewModel {
  const team = teamsById.get(standing.teamId);
  return {
    teamId: standing.teamId,
    teamName: team?.name ?? 'Unknown team',
    isMyTeam: team?.isMyTeam ?? false,
    points: standing.points,
    isProvisional: standing.isProvisional,
  };
}
