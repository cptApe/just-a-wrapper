import { AppError } from '@/lib/errors';
import type { ChatItem, ChatState, ToolChatItem } from './chat-state';
import { selectToolItems, toolsStopped } from './chat-turns';
import type { ToolRequests } from './tool-request-machine';

export function selectUnresolvedCustomToolCalls(items: readonly ChatItem[]): ToolChatItem[] {
  return selectToolItems(items).filter(
    (item) => item.tool === 'custom' && item.result === undefined,
  );
}

export function selectActiveAutoDispatchToolUseIds(
  items: readonly ChatItem[],
  replaySettled: boolean,
  requests: ToolRequests,
): Set<string> {
  return new Set(
    replaySettled
      ? selectUnresolvedCustomToolCalls(items)
          .filter((call) => {
            const request = requests.get(call.id);
            return !request || request.kind === 'dispatching' || request.kind === 'waiting';
          })
          .map((call) => call.id)
      : [],
  );
}

export function selectCustomToolDispatchCalls(
  state: Pick<ChatState, 'status' | 'stopReason' | 'items'>,
  replaySettled: boolean,
  requests: ToolRequests,
  now: number,
) {
  if (!replaySettled || toolsStopped(state)) return [];
  return selectUnresolvedCustomToolCalls(state.items)
    .filter((call) => {
      if (
        call.threadId === undefined &&
        !(state.status === 'idle' && state.stopReason === 'requires_action')
      )
        return false;
      const request = requests.get(call.id);
      return !request || (request.kind === 'waiting' && request.retryAt <= now);
    })
    .map((call) => ({ toolUseId: call.id, name: call.name }));
}

export function getAlreadyResolvedCustomToolDispatchId(error: unknown): string | null {
  if (
    error instanceof AppError &&
    error.code === 'API_REQUEST_FAILED' &&
    error.context.status === 400 &&
    error.context.serverCode === 'CUSTOM_TOOL_ALREADY_RESOLVED' &&
    typeof error.context.serverToolUseId === 'string'
  )
    return error.context.serverToolUseId;
  return null;
}
