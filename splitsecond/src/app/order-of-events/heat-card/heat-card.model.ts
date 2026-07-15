import { PhysicalHeatStatus } from '../../core/models/domain.models';

export interface LaneViewModel {
  laneNo: number;
  swimmerName: string | null;
  teamName: string | null;
  seedTimeMs: number | null;
  isMyTeam: boolean;
}

export interface HeatCardViewModel {
  id: string;
  eventNo: number;
  eventTitle: string;
  heatNo: number | null;
  status: PhysicalHeatStatus;
  lanes: LaneViewModel[];
}
