import type {
  BetaManagedAgentsUserCustomToolResultEventParams,
  BetaManagedAgentsUserToolConfirmationEventParams,
} from '@anthropic-ai/sdk/resources/beta/sessions/events';

/** Wrap a handler result as the single text content block the API expects. */
function toToolResultContent(content: unknown): Array<{ type: 'text'; text: string }> {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? null);
  return [{ type: 'text', text }];
}

export function buildCustomToolResultEvent(args: {
  toolUseId: string;
  isError: boolean;
  content: unknown;
}): BetaManagedAgentsUserCustomToolResultEventParams {
  return {
    type: 'user.custom_tool_result',
    custom_tool_use_id: args.toolUseId,
    is_error: args.isError,
    content: toToolResultContent(args.content),
  };
}

export function buildToolConfirmationEvent(args: {
  toolUseId: string;
  result: 'allow' | 'deny';
  denyMessage?: string;
  threadId?: string;
}): BetaManagedAgentsUserToolConfirmationEventParams {
  return {
    type: 'user.tool_confirmation',
    tool_use_id: args.toolUseId,
    result: args.result,
    // `deny_message` is only allowed when result is 'deny'.
    ...(args.result === 'deny' && args.denyMessage ? { deny_message: args.denyMessage } : {}),
    ...(args.threadId ? { session_thread_id: args.threadId } : {}),
    // SDK params omit session_thread_id, while the inbound event documents that
    // helper confirmations must echo it (events.d.ts:1391-1396).
  };
}
