export interface ResultViewModel {
  physicalLaneId: string;
  place: number;
  swimmerName: string | null;
  teamId: string | null;
  teamName: string;
  isMyTeam: boolean;
  timeMs: number;
  points: number;
  seedTimeMs: number | null;
  deltaMs: number | null; // timeMs - seedTimeMs; positive = slower than seed, null = no seed on file
  splits: number[];
}

export interface EventResultsViewModel {
  eventId: string;
  eventNo: number;
  eventTitle: string;
  ageGroup: string | null;
  gender: string;
  isRelay: boolean;
  isProvisional: boolean;
  results: ResultViewModel[];
  // When this event first had at least one swimmer's time recorded — drives the Results event
  // dropdown's default selection (most recently completed event), not display order.
  firstCompletedAt: string;
}

export interface TeamOption {
  id: string;
  name: string;
}

export interface EventOption {
  id: string;
  title: string;
}
