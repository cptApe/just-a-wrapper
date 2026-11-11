export type SidebarActivity = { kind: 'idle' } | { kind: 'sending'; startedAt: number };
export type SidebarActivityAction =
  | { type: 'start'; startedAt: number }
  | { type: 'settle'; force: boolean; status: string };
export function sidebarActivityReducer(
  state: SidebarActivity,
  action: SidebarActivityAction,
): SidebarActivity {
  if (action.type === 'start') return { kind: 'sending', startedAt: action.startedAt };
  if (!action.force && action.status === 'idle' && state.kind === 'sending') return state;
  return state.kind === 'idle' ? state : { kind: 'idle' };
}
