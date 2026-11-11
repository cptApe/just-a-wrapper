import type { ChatEvent } from '@/features/sessions';
import { defineStateMachine } from '@/lib/state-machine';
import { STREAM_STALE_MS, streamRecoveryDelayMs } from './stream-staleness';

const machine = defineStateMachine('chat connection', {
  connecting: ['connecting', 'access_lost', 'open', 'reconnecting', 'done', 'error'],
  open: ['open', 'access_lost', 'connecting', 'reconnecting', 'done', 'error'],
  reconnecting: ['reconnecting', 'access_lost', 'connecting', 'open', 'done', 'error'],
  done: ['connecting'],
  error: ['connecting'],
  access_lost: [],
});

type ConnectionPhase =
  | { status: 'connecting' | 'open' | 'reconnecting' | 'done'; error: null }
  | { status: 'error'; error: { code: string } }
  | { status: 'access_lost'; error: { code: string } };
type Replay = { kind: 'replaying'; latestStatus: ChatEvent | null } | { kind: 'settled' };
export type ConnectionState = ConnectionPhase & {
  epoch: number;
  replay: Replay;
  lastFrameAt: number;
  attempts: number;
  retryAt: number | null;
  traceId: string | null;
  lastSeenEventId: string | null;
};
export type ConnectionAction =
  | { type: 'remint'; now: number }
  | { type: 'tick'; now: number; running: boolean }
  | { type: 'open' | 'reconnecting' | 'recover' | 'done' | 'history'; epoch: number; now: number }
  | { type: 'frame' | 'socket_started'; epoch: number; now: number }
  | { type: 'status'; epoch: number; event: ChatEvent }
  | { type: 'meta'; epoch: number; traceId: string | null; lastSeenEventId: string | null }
  | { type: 'error'; epoch: number; error: { code: string } };

export function initialConnection(now: number): ConnectionState {
  return {
    status: 'connecting',
    error: null,
    epoch: 0,
    replay: { kind: 'replaying', latestStatus: null },
    lastFrameAt: now,
    attempts: 0,
    retryAt: null,
    traceId: null,
    lastSeenEventId: null,
  };
}

function remint(state: ConnectionState, now: number): ConnectionState {
  if (!machine.can(state.status, 'connecting')) return state;
  return {
    ...state,
    status: 'connecting',
    error: null,
    epoch: state.epoch + 1,
    replay: { kind: 'replaying', latestStatus: null },
    lastFrameAt: now,
    retryAt: null,
  };
}

export function connectionReducer(
  state: ConnectionState,
  action: ConnectionAction,
): ConnectionState {
  if ('epoch' in action && action.epoch !== state.epoch) return state;
  if (action.type === 'remint') return remint(state, action.now);
  const target =
    action.type === 'error'
      ? action.error.code === 'ACCESS_LOST'
        ? 'access_lost'
        : 'error'
      : action.type === 'recover' || action.type === 'tick'
        ? 'reconnecting'
        : action.type === 'open' || action.type === 'reconnecting' || action.type === 'done'
          ? action.type
          : null;
  if (target && !machine.can(state.status, target)) return state;
  if (state.status === 'error' || state.status === 'done' || state.status === 'access_lost')
    return state;
  switch (action.type) {
    case 'tick': {
      if (state.retryAt !== null)
        return action.now >= state.retryAt ? remint(state, action.now) : state;
      const deadline = state.status === 'connecting' ? 10_000 : STREAM_STALE_MS;
      if (
        (state.status !== 'connecting' && !action.running) ||
        action.now - state.lastFrameAt < deadline
      )
        return state;
      return {
        ...state,
        status: 'reconnecting',
        retryAt: action.now + streamRecoveryDelayMs(state.attempts),
        attempts: Math.min(state.attempts + 1, 5),
      };
    }
    case 'open':
      return {
        ...state,
        status: 'open',
        error: null,
        attempts: 0,
        retryAt: null,
        lastFrameAt: action.now,
      };
    case 'reconnecting':
      return { ...state, status: 'reconnecting' };
    case 'recover':
      return state.retryAt !== null
        ? state
        : {
            ...state,
            status: 'reconnecting',
            retryAt: action.now + streamRecoveryDelayMs(state.attempts),
            attempts: Math.min(state.attempts + 1, 5),
          };
    case 'socket_started':
      return { ...state, lastFrameAt: action.now };
    case 'frame':
      if (state.attempts === 0 && state.retryAt === null && action.now - state.lastFrameAt < 1000)
        return state;
      return { ...state, lastFrameAt: action.now, attempts: 0, retryAt: null };
    case 'status':
      return state.replay.kind === 'settled'
        ? state
        : { ...state, replay: { kind: 'replaying', latestStatus: action.event } };
    case 'history':
      return { ...state, replay: { kind: 'settled' } };
    case 'done':
      return { ...state, status: 'done', replay: { kind: 'settled' }, retryAt: null };
    case 'error':
      return {
        ...state,
        status: action.error.code === 'ACCESS_LOST' ? 'access_lost' : 'error',
        error: action.error,
        retryAt: null,
      };
    case 'meta':
      return {
        ...state,
        traceId: action.traceId,
        lastSeenEventId: action.lastSeenEventId ?? state.lastSeenEventId,
      };
  }
}
