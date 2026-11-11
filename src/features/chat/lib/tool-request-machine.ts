import { TOOL_EXECUTION_LEASE_MS } from '@/features/tools/lib/tool-delivery-machine';

// Built-in gates and custom tools fail approval with the same words.
export const TOOL_ACTION_FAILED_MESSAGE = 'Couldn’t update this action. Try again.';

type ToolRequest =
  | { kind: 'dispatching'; attempt: symbol; failures: number; progressDeadline?: number }
  | { kind: 'waiting'; retryAt: number; failures: number; progressDeadline?: number }
  | { kind: 'exhausted'; failures: number }
  | { kind: 'pending' }
  | { kind: 'confirming'; attempt: symbol }
  | { kind: 'posted' };
export type ToolRequests = ReadonlyMap<string, ToolRequest>;
export type ToolRequestAction =
  | { type: 'dispatch'; ids: string[]; attempt: symbol; now: number }
  | { type: 'progress'; id: string; attempt: symbol; now: number }
  | { type: 'pending'; id: string }
  | { type: 'confirm'; ids: string[]; attempt: symbol }
  | { type: 'posted'; id: string; attempt: symbol }
  | { type: 'failed'; ids: string[]; attempt: symbol; now: number }
  | { type: 'retry'; ids: string[] }
  | { type: 'cancel'; ids: string[]; attempt: symbol };

// Returns the same map when no request moves, so the reducer store skips its listeners.
export function toolRequestReducer(state: ToolRequests, action: ToolRequestAction): ToolRequests {
  if (action.type === 'pending') {
    const current = state.get(action.id);
    if (current?.kind === 'posted' || current?.kind === 'confirming' || current?.kind === 'pending')
      return state;
    return new Map(state).set(action.id, { kind: 'pending' });
  }
  const next = new Map(state);
  const ids = action.type === 'posted' || action.type === 'progress' ? [action.id] : action.ids;
  for (const id of ids) {
    const current = state.get(id);
    switch (action.type) {
      case 'dispatch':
        if (!current || (current.kind === 'waiting' && action.now >= current.retryAt))
          next.set(id, {
            kind: 'dispatching',
            attempt: action.attempt,
            failures: current?.failures ?? 0,
            progressDeadline: current?.progressDeadline,
          });
        break;
      case 'progress': {
        if (current?.kind !== 'dispatching' || current.attempt !== action.attempt) break;
        const deadline = current.progressDeadline ?? action.now + TOOL_EXECUTION_LEASE_MS + 10_000;
        next.set(
          id,
          action.now >= deadline
            ? { kind: 'exhausted', failures: current.failures }
            : {
                kind: 'waiting',
                failures: current.failures,
                retryAt: action.now + 5_000,
                progressDeadline: deadline,
              },
        );
        break;
      }
      case 'confirm':
        if (current?.kind === 'pending')
          next.set(id, { kind: 'confirming', attempt: action.attempt });
        break;
      case 'posted':
        if (current && 'attempt' in current && current.attempt === action.attempt)
          next.set(id, { kind: 'posted' });
        break;
      case 'failed':
        if (!current || !('attempt' in current) || current.attempt !== action.attempt) break;
        if (current.kind === 'confirming') next.set(id, { kind: 'pending' });
        else {
          const failures = current.failures + 1;
          next.set(
            id,
            failures >= 3
              ? { kind: 'exhausted', failures }
              : { kind: 'waiting', failures, retryAt: action.now + 500 },
          );
        }
        break;
      case 'cancel':
        if (current?.kind === 'dispatching' && current.attempt === action.attempt)
          next.set(id, { kind: 'waiting', failures: current.failures, retryAt: 0 });
        break;
      case 'retry':
        if (current?.kind === 'exhausted') next.delete(id);
        break;
    }
  }
  return next.size === state.size && ids.every((id) => next.get(id) === state.get(id))
    ? state
    : next;
}
