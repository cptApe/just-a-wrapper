export type LaneStatus = 'running' | 'idle' | 'rescheduled' | 'terminated';

export function laneStatusReducer(current: LaneStatus, requested: LaneStatus): LaneStatus {
  return current === 'terminated' ? current : requested;
}
