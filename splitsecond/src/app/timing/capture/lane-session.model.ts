// This capture screen's in-progress state for one lane, kept by the page (not the lane-row
// component) since both an individual "Finish" tap and the bulk "finish selected" action need to
// set it — see capture.page.ts.
export interface LaneSession {
  splits: number[];
  finishedObservationId: string | null;
  finishedFinalTimeMs: number | null;
}

export function emptyLaneSession(): LaneSession {
  return { splits: [], finishedObservationId: null, finishedFinalTimeMs: null };
}
