import { ObservationSource, PhysicalLaneStatus } from '../../../core/models/domain.models';

// A past, already-persisted observation for this lane — read-only history shown alongside the
// active capture controls (could be this coach's own re-run, or another coach's time).
export interface ObservationSummary {
  id: string;
  finalTimeMs: number | null;
  source: ObservationSource;
  isMine: boolean;
}

export interface LaneRowViewModel {
  laneId: string;
  laneNo: number;
  swimmerName: string | null;
  teamName: string | null;
  seedTimeMs: number | null;
  isMyTeam: boolean;
  status: PhysicalLaneStatus;
  observations: ObservationSummary[];
  // This capture session's in-progress state (owned by the capture page, not this component —
  // both an individual Finish tap and a bulk "finish selected" action need to set it).
  splits: number[];
  isFinished: boolean;
  finishedFinalTimeMs: number | null;
  isSelected: boolean;
}
