import type { ChatState } from './chat-state';
import { selectUnresolvedCustomToolCalls } from './custom-tool-dispatch-retry';

type ChatWorkingInput = {
  state: Pick<ChatState, 'items' | 'status' | 'stopReason'>;
  streamStatus: string;
  sendInFlight: boolean;
  /** Calls waiting on the user, keyed by tool use id. */
  pendingUserToolUseIds: { has: (toolUseId: string) => boolean };
  autoDispatchToolUseIds: ReadonlySet<string>;
};

/** Whether the current task should present as actively working. A
 * requires-action park stays active only while a browser-dispatched custom
 * tool is unresolved; calls surfaced in the pending confirmation queue are
 * waiting on the user and deliberately yield the composer back to send mode. */
export function isChatWorking({
  state,
  streamStatus,
  sendInFlight,
  pendingUserToolUseIds,
  autoDispatchToolUseIds,
}: ChatWorkingInput): boolean {
  if (
    state.status === 'paused_no_credits' ||
    state.status === 'terminated' ||
    streamStatus === 'access_lost'
  )
    return false;

  const streamSettled = streamStatus === 'done' || streamStatus === 'error';
  const agentRunning = state.status === 'running' && !streamSettled;
  const dispatchExecuting =
    state.status === 'idle' &&
    state.stopReason === 'requires_action' &&
    selectUnresolvedCustomToolCalls(state.items).some(
      (call) => autoDispatchToolUseIds.has(call.id) && !pendingUserToolUseIds.has(call.id),
    );

  return agentRunning || dispatchExecuting || (sendInFlight && streamStatus !== 'error');
}

// A workspace pause outranks both the stream and the sidebar's cached activity.
export function composerSendMode({
  paused,
  running,
  stopping,
}: {
  paused: boolean;
  running: boolean;
  stopping: boolean;
}): 'send' | 'stop' | 'stopping' {
  return paused || !running ? 'send' : stopping ? 'stopping' : 'stop';
}
