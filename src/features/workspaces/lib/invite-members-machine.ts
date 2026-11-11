import type { ActionState } from '@/lib/action-state';
import type { WorkspaceRole } from './roles';
export type InviteResult = { email: string } & ActionState<{ emailSent: boolean }>;
type Draft = { raw: string; role: WorkspaceRole };
export type InviteMembersState =
  | ({ kind: 'editing'; results: InviteResult[]; error: string | null } & Draft)
  | ({ kind: 'sending'; attempt: symbol } & Draft);
export type InviteMembersEvent =
  | { type: 'raw'; raw: string }
  | { type: 'role'; role: WorkspaceRole }
  | { type: 'invalid'; message: string }
  | { type: 'send'; attempt: symbol }
  | { type: 'finish'; attempt: symbol; results: InviteResult[] };
export function inviteMembersReducer(
  state: InviteMembersState,
  event: InviteMembersEvent,
): InviteMembersState {
  if (event.type === 'finish') {
    if (state.kind !== 'sending' || state.attempt !== event.attempt) return state;
    return {
      kind: 'editing',
      raw: event.results
        .filter((result) => !result.ok)
        .map((result) => result.email)
        .join('\n'),
      role: state.role,
      results: event.results,
      error: null,
    };
  }
  if (state.kind === 'sending') return state;
  switch (event.type) {
    case 'raw':
      return { ...state, raw: event.raw, error: null };
    case 'role':
      return { ...state, role: event.role };
    case 'invalid':
      return { ...state, error: event.message };
    case 'send':
      return { kind: 'sending', raw: state.raw, role: state.role, attempt: event.attempt };
  }
}
