import type { WorkspaceSessionListItem } from '../types';

type Status = WorkspaceSessionListItem['status'];
export function reduceSessionActivity(
  state: Pick<WorkspaceSessionListItem, 'status' | 'unread'>,
  action: { status: Status; active: boolean },
): Pick<WorkspaceSessionListItem, 'status' | 'unread'> {
  if (state.status === 'terminated' && action.status !== 'terminated') return state;
  const completed = action.status !== 'running' && action.status !== 'rescheduling';
  return {
    status: action.status,
    unread: action.active ? false : state.unread || (state.status !== action.status && completed),
  };
}
