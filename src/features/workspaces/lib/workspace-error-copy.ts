import { AppError, type ErrorCode } from '@/lib/errors';

type WorkspaceAction =
  | 'rename'
  | 'create'
  | 'role'
  | 'remove'
  | 'deleteAccount'
  | 'leave'
  | 'deleteWorkspace';
// The server refuses self-removal with this sentence, and the members menu shows it before trying.
export const USE_LEAVE_WORKSPACE_COPY =
  'Use Leave workspace in the workspace settings to remove yourself.';
const SIGN_IN_EXPIRED = 'Your sign-in expired. Refresh the page and try again.';
const NAME_INVALID = 'Workspace names must be 1–100 characters.';
// Client-safe messages keyed off the error code, never raw internals.
const ERROR_COPY: Record<WorkspaceAction, Partial<Record<ErrorCode, string>>> = {
  leave: {
    UNAUTHENTICATED: 'Your sign-in expired. Refresh and try again.',
    SOLE_OWNER_BLOCKED: 'Make someone else an owner before you leave.',
    LAST_WORKSPACE_BLOCKED: 'This is your only workspace, so you cannot leave it.',
  },
  deleteWorkspace: {
    UNAUTHENTICATED: 'Your sign-in expired. Refresh and try again.',
    FORBIDDEN: 'Only the workspace owner can delete it.',
    VALIDATION_FAILED: 'The name you typed does not match the workspace name.',
    LAST_WORKSPACE_BLOCKED: 'This is your only workspace, so you cannot delete it.',
  },
  deleteAccount: {
    VALIDATION_FAILED: 'That does not match your email address.',
    SOLE_OWNER_BLOCKED:
      'You are the only owner of a workspace with other members. Make someone else an owner or remove members first.',
    UNAUTHENTICATED: SIGN_IN_EXPIRED,
  },
  rename: {
    TOOL_INPUT_INVALID: NAME_INVALID,
    FORBIDDEN: 'Only workspace owners and admins can rename the workspace.',
    UNAUTHENTICATED: 'Your sign-in expired. Refresh the page to sign in again.',
    WORKSPACE_NOT_FOUND:
      'Your workspace is still being set up. Give it a few seconds and try again.',
  },
  create: {
    PLAN_LIMIT_REACHED:
      'You can own up to 5 workspaces. Delete one you no longer use to add another.',
    TOOL_INPUT_INVALID: NAME_INVALID,
    UNAUTHENTICATED: 'Your sign-in expired. Refresh the page to sign in again.',
  },
  role: {
    UNAUTHENTICATED: SIGN_IN_EXPIRED,
    SOLE_OWNER_BLOCKED: 'Make someone else an owner before changing this role.',
    FORBIDDEN: 'Only workspace owners and admins can change member roles.',
    VALIDATION_FAILED: 'Choose a valid member and role, then try again.',
  },
  remove: {
    UNAUTHENTICATED: SIGN_IN_EXPIRED,
    SOLE_OWNER_BLOCKED: 'Make someone else an owner before removing this member.',
    FORBIDDEN: 'Only workspace owners and admins can remove members.',
    VALIDATION_FAILED: 'Choose a valid workspace member and try again.',
  },
};
const UNEXPECTED_COPY: Record<WorkspaceAction, string> = {
  leave: 'Could not leave the workspace. Please try again.',
  deleteWorkspace: 'Could not delete the workspace. Please try again.',
  deleteAccount: 'Could not delete your account. Please try again.',
  rename: 'Couldn’t rename the workspace. Please try again.',
  create: 'Couldn’t create the workspace. Please try again.',
  role: 'Couldn’t change this role. Please try again.',
  remove: 'Couldn’t remove this member. Please try again.',
};

function workspaceErrorMessage(action: WorkspaceAction, error: unknown): string {
  if (!(error instanceof AppError)) return UNEXPECTED_COPY[action];
  const {
    code,
    context: { reason },
  } = error;
  if (code === 'FORBIDDEN' && reason === 'OWNER_ROLE_REQUIRES_OWNER') {
    if (action === 'role') return 'Only an owner can change owner roles.';
    if (action === 'remove') return 'Only an owner can remove another owner.';
  }
  if (action === 'remove' && code === 'VALIDATION_FAILED' && reason === 'USE_LEAVE_WORKSPACE') {
    return USE_LEAVE_WORKSPACE_COPY;
  }
  return ERROR_COPY[action][code] ?? UNEXPECTED_COPY[action];
}

// The runAction boundary for a workspace action: the unexpected copy is the
// fallback and each AppError code maps to its own copy.
export function workspaceActionBoundary(route: string, action: WorkspaceAction) {
  return {
    route,
    feature: 'workspaces',
    message: UNEXPECTED_COPY[action],
    appErrorMessage: (error: AppError) => workspaceErrorMessage(action, error),
  };
}
