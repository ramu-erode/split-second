import { TeamStandingViewModel } from './standing-row/standing-row.model';

export interface GroupStandingsViewModel {
  key: string;
  title: string;
  standings: TeamStandingViewModel[];
}
