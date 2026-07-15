import {
  Event,
  PhysicalHeat,
  PhysicalLane,
  Swimmer,
  Team,
} from '../../core/models/domain.models';
import { HeatCardViewModel, LaneViewModel } from '../heat-card/heat-card.model';

export function buildHeatViewModels(
  physicalHeats: PhysicalHeat[],
  lanesByHeatId: Map<string, PhysicalLane[]>,
  eventsById: Map<string, Event>,
  heatNoByPhysicalHeatId: Map<string, number>,
  teamsById: Map<string, Team>,
  swimmersById: Map<string, Swimmer>
): HeatCardViewModel[] {
  // Includes completed heats — callers decide whether/where to surface those (CLAUDE.md smart/dumb
  // split: this builder is a pure mapper, not the place for a page's "what to show" business rule).
  return physicalHeats
    .map((h) =>
      toHeatViewModel(h, lanesByHeatId, eventsById, heatNoByPhysicalHeatId, teamsById, swimmersById)
    )
    .filter((vm): vm is HeatCardViewModel => vm !== null)
    .sort((a, b) => a.eventNo - b.eventNo || (a.heatNo ?? 0) - (b.heatNo ?? 0));
}

function toHeatViewModel(
  heat: PhysicalHeat,
  lanesByHeatId: Map<string, PhysicalLane[]>,
  eventsById: Map<string, Event>,
  heatNoByPhysicalHeatId: Map<string, number>,
  teamsById: Map<string, Team>,
  swimmersById: Map<string, Swimmer>
): HeatCardViewModel | null {
  const lanes = (lanesByHeatId.get(heat.id) ?? []).slice().sort((a, b) => a.laneNo - b.laneNo);
  const eventId = lanes.find((l) => l.eventId)?.eventId;
  const event = eventId ? eventsById.get(eventId) : undefined;
  if (!event) return null;
  return {
    id: heat.id,
    eventNo: event.eventNo,
    eventTitle: formatEventTitle(event),
    heatNo: heatNoByPhysicalHeatId.get(heat.id) ?? null,
    status: heat.status,
    lanes: lanes.map((l) => toLaneViewModel(l, teamsById, swimmersById)),
  };
}

function toLaneViewModel(
  lane: PhysicalLane,
  teamsById: Map<string, Team>,
  swimmersById: Map<string, Swimmer>
): LaneViewModel {
  const team = lane.teamId ? teamsById.get(lane.teamId) : undefined;
  const swimmer = lane.swimmerId ? swimmersById.get(lane.swimmerId) : undefined;
  return {
    laneNo: lane.laneNo,
    swimmerName: swimmer?.name ?? null,
    teamName: team?.name ?? null,
    seedTimeMs: lane.seedTimeMs,
    isMyTeam: team?.isMyTeam ?? false,
  };
}

export function filterHeatViewModels(
  heats: HeatCardViewModel[],
  query: string
): HeatCardViewModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return heats;
  return heats.filter(
    (h) =>
      h.eventTitle.toLowerCase().includes(q) ||
      h.lanes.some(
        (l) => l.swimmerName?.toLowerCase().includes(q) || l.teamName?.toLowerCase().includes(q)
      )
  );
}

export function formatEventTitle(event: Event): string {
  return [event.gender, event.ageGroup, `${event.distanceM}m`, event.stroke]
    .filter(Boolean)
    .join(' ');
}
