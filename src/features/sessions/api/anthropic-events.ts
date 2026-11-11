import 'server-only';
import { APIError } from '@anthropic-ai/sdk';
import { requireAnthropicClient } from '@/features/agents';
import { AppError } from '@/lib/errors';
import { collectUnresolvedGates, type UnresolvedGate } from '../lib/relay-translator';
import { buildCustomToolResultEvent, buildToolConfirmationEvent } from '../lib/tool-events';

const GATE_LOOKUP_LIMIT = 200;
const GATE_LOOKUP_TIMEOUT_MS = 30_000;
const CUSTOM_TOOL_LOOKUP_PAGE_SIZE = 200;
const CUSTOM_TOOL_LOOKUP_LIMIT = 2_000;
export const CUSTOM_TOOL_ALREADY_RESOLVED = 'CUSTOM_TOOL_ALREADY_RESOLVED';

// The Anthropic event poster — talks to Anthropic via the shared client singleton.
export const anthropicEventPoster = {
  async isToolResultDelivered(
    sessionId: string,
    call: { toolUseId: string; name: string },
  ): Promise<boolean | 'unavailable'> {
    try {
      await assertPendingAnthropicCustomToolCalls(sessionId, [call], 'reject');
      return false;
    } catch (cause) {
      if (cause instanceof AppError && cause.context.rejectionCode === CUSTOM_TOOL_ALREADY_RESOLVED)
        return true;
      if (
        (cause instanceof APIError && (cause.status === 404 || cause.status === 410)) ||
        (cause instanceof AppError && cause.code === 'TOOL_INPUT_INVALID')
      )
        return 'unavailable';
      throw cause;
    }
  },
  async postCustomToolResult({
    sessionId,
    toolUseId,
    isError,
    content,
  }: {
    sessionId: string;
    toolUseId: string;
    isError: boolean;
    content: unknown;
  }) {
    const client = requireAnthropicClient();
    await client.beta.sessions.events.send(sessionId, {
      events: [buildCustomToolResultEvent({ toolUseId, isError, content })],
    });
  },
  async postToolConfirmation({
    sessionId,
    toolUseId,
    result,
    denyMessage,
    threadId,
  }: {
    sessionId: string;
    toolUseId: string;
    result: 'allow' | 'deny';
    denyMessage?: string;
    threadId?: string;
  }) {
    const client = requireAnthropicClient();
    await client.beta.sessions.events.send(sessionId, {
      events: [buildToolConfirmationEvent({ toolUseId, result, denyMessage, threadId })],
    });
  },
};

/** Resolve gates across every history page so older unanswered gates remain actionable. */
export async function listOpenAnthropicGates(
  sessionId: string,
): Promise<ReadonlyMap<string, UnresolvedGate>> {
  const client = requireAnthropicClient();
  const page = await client.beta.sessions.events.list(
    sessionId,
    {
      order: 'desc',
      limit: GATE_LOOKUP_LIMIT,
      types: [
        'agent.tool_use',
        'agent.mcp_tool_use',
        'user.tool_confirmation',
        'agent.tool_result',
        'agent.mcp_tool_result',
      ],
    },
    { timeout: GATE_LOOKUP_TIMEOUT_MS },
  );
  const events = [];
  for await (const event of page) events.push(event);
  const chronological = events.reverse();
  return new Map(collectUnresolvedGates(chronological).map((gate) => [gate.toolUseId, gate]));
}

/** Refuse client-invented dispatch calls. Only unresolved custom-tool uses that
 * Anthropic actually emitted for this session may cross the route boundary. */
export async function assertPendingAnthropicCustomToolCalls(
  sessionId: string,
  calls: ReadonlyArray<{ toolUseId: string; name: string }>,
  resolved: 'reject' | 'skip',
): Promise<{ inputs: ReadonlyMap<string, unknown>; resolvedIds: ReadonlySet<string> }> {
  const client = requireAnthropicClient();
  const inputs = new Map<string, unknown>();
  const requestedIds = new Set(calls.map((call) => call.toolUseId));
  const resolvedIds = new Set<string>();
  const pending = new Map<string, string>();
  let scanned = 0;
  let pageToken: string | null | undefined;

  while (scanned < CUSTOM_TOOL_LOOKUP_LIMIT && pending.size < requestedIds.size) {
    const page = await client.beta.sessions.events.list(
      sessionId,
      {
        order: 'desc',
        limit: Math.min(CUSTOM_TOOL_LOOKUP_PAGE_SIZE, CUSTOM_TOOL_LOOKUP_LIMIT - scanned),
        types: ['agent.custom_tool_use', 'user.custom_tool_result'],
        ...(pageToken ? { page: pageToken } : {}),
      },
      { timeout: GATE_LOOKUP_TIMEOUT_MS },
    );

    for (const event of page.data) {
      scanned += 1;
      if (event.type === 'user.custom_tool_result') {
        if (requestedIds.has(event.custom_tool_use_id)) {
          resolvedIds.add(event.custom_tool_use_id);
        }
      } else if (
        event.type === 'agent.custom_tool_use' &&
        requestedIds.has(event.id) &&
        !resolvedIds.has(event.id) &&
        !pending.has(event.id)
      ) {
        pending.set(event.id, event.name);
        inputs.set(event.id, event.input);
      }
      if (scanned >= CUSTOM_TOOL_LOOKUP_LIMIT) break;
    }

    pageToken = page.next_page;
    if (!pageToken) break;
  }

  assertPendingCallsMatch(sessionId, calls, pending, resolvedIds, resolved);
  return { inputs, resolvedIds };
}

function assertPendingCallsMatch(
  sessionId: string,
  calls: ReadonlyArray<{ toolUseId: string; name: string }>,
  pending: Map<string, string>,
  resolvedIds: ReadonlySet<string>,
  resolved: 'reject' | 'skip',
): void {
  for (const call of calls) {
    if (pending.get(call.toolUseId) !== call.name) {
      if (resolvedIds.has(call.toolUseId)) {
        if (resolved === 'skip') continue;
        throw new AppError('TOOL_INPUT_INVALID', 'Custom tool call already has a result upstream', {
          sessionId,
          toolUseId: call.toolUseId,
          toolName: call.name,
          rejectionCode: CUSTOM_TOOL_ALREADY_RESOLVED,
        });
      }
      throw new AppError('TOOL_INPUT_INVALID', 'Custom tool call is not pending upstream', {
        sessionId,
        toolUseId: call.toolUseId,
        toolName: call.name,
      });
    }
    pending.delete(call.toolUseId);
  }
}
