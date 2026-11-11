// Public surface of the sessions feature — the SSE relay + the session lifecycle
// calls the chat surface and routes consume. Internals (the event mirror) stay
// private.

export { interruptSession } from './api/interrupt-session';
export { listSessionEvents } from './api/list-session-events';
export {
  loadSessionStatus,
  type SessionLiveState,
  type SessionPauseReason,
} from './api/load-session-status';
export { markSessionSeen } from './api/mark-session-seen';
export { resolveSessionStartGrounding } from './api/resolve-session-grounding';
export {
  authorizeSessionAccess,
  authorizeSessionIdentityWrite,
  authorizeSessionWrite,
  resolveSessionUuidByAnthropicId,
  sessionRouteErrorResponse,
} from './api/session-access';
export { deleteSession, updateSessionDetails } from './api/update-session';
export { composeDeploymentSystemText } from './lib/session-context';
export type {
  ChatErrorRetryStatus,
  ChatEvent,
  ChatFileRef,
  ChatPreviewType,
  ChatThreadDetail,
  ChatToolKind,
  RelayFrame,
  WorkspaceSessionDetail,
  WorkspaceSessionListItem,
} from './types';
