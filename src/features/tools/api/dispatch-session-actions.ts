import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { member, session, workspace, workspaceNotDeleted } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { notifyTaskEvent } from '@/features/notifications/api/notify-task-events';
import { applyGatePolicy } from '@/features/session-runtime/api/apply-gate-policy';
import { creatorGateResolver } from '@/features/session-runtime/api/creator-gate';
import { collectUnresolvedGates } from '@/features/sessions/lib/relay-translator';
import type { ToolCall } from '@/features/tool-catalog/types';
import { AppError } from '@/lib/errors';
import { dispatchSessionToolCalls } from './dispatch-request';

// The creator owns the credentials and permissions even when no browser is attached.
export async function dispatchSessionActions(anthropicSessionId: string): Promise<void> {
  const owner = await loadDispatchOwner(anthropicSessionId);
  if (!owner) return;
  const client = requireAnthropicClient();
  const context = {
    anthropicSessionId,
    sessionRowId: owner.session.id,
    workspaceId: owner.session.workspaceId,
    organizationId: owner.organizationId,
    userId: owner.session.createdByUserId,
    actorUserId: owner.session.createdByUserId,
  };
  const idle = await readLatestStatus(client, anthropicSessionId);
  if (idle?.type !== 'session.status_idle' || idle.stop_reason.type !== 'requires_action') return;
  const ids = new Set(idle.stop_reason.event_ids);
  const events = await readActionEvents(client, anthropicSessionId, ids);
  const resolved = new Set(
    events.flatMap((event) =>
      event.type === 'user.custom_tool_result' ? [event.custom_tool_use_id] : [],
    ),
  );
  const calls: ToolCall[] = events.flatMap((event) =>
    event.type === 'agent.custom_tool_use' && ids.has(event.id) && !resolved.has(event.id)
      ? [{ toolUseId: event.id, name: event.name, input: event.input }]
      : [],
  );
  const outcomes = calls.length > 0 ? await dispatchSessionToolCalls(calls, context, 'skip') : [];
  const gateOutcomes = await applySessionGates(client, owner, anthropicSessionId, events, ids);
  const needsInput =
    outcomes.some((outcome) => outcome.status === 'pending') || gateOutcomes.includes('gate');
  if (needsInput)
    await notifyTaskEvent({ anthropicSessionId, event: 'task.needs_input', eventId: idle.id });
  if (
    gateOutcomes.includes('retry') ||
    outcomes.some((outcome) => outcome.status === 'retry' && outcome.detail === 'DELIVERY_PENDING')
  )
    throw new AppError('EXTERNAL_API_FAILED', 'Session tools require another recovery attempt', {
      anthropicSessionId,
    });
}

async function readLatestStatus(
  client: ReturnType<typeof requireAnthropicClient>,
  anthropicSessionId: string,
) {
  const statuses = await client.beta.sessions.events.list(
    anthropicSessionId,
    {
      order: 'desc',
      types: [
        'session.status_idle',
        'session.status_running',
        'session.status_rescheduled',
        'session.status_terminated',
        'user.message',
        'user.interrupt',
      ],
      limit: 1,
    },
    { timeout: 30_000 },
  );
  return statuses.data.at(0);
}

async function loadDispatchOwner(anthropicSessionId: string) {
  return (
    await db
      .select({ session, organizationId: workspace.organizationId })
      .from(session)
      .innerJoin(workspace, and(eq(workspace.id, session.workspaceId), workspaceNotDeleted))
      .innerJoin(
        member,
        and(
          eq(member.organizationId, workspace.organizationId),
          eq(member.userId, session.createdByUserId),
        ),
      )
      .where(
        and(
          eq(session.anthropicSessionId, anthropicSessionId),
          isNull(session.hiddenAt),
          inArray(session.status, ['running', 'idle', 'requires_input', 'rescheduling']),
        ),
      )
      .limit(1)
  ).at(0);
}

async function applySessionGates(
  client: ReturnType<typeof requireAnthropicClient>,
  owner: NonNullable<Awaited<ReturnType<typeof loadDispatchOwner>>>,
  anthropicSessionId: string,
  events: Awaited<ReturnType<typeof readActionEvents>>,
  ids: ReadonlySet<string>,
) {
  const outcomes: Awaited<ReturnType<typeof applyGatePolicy>>[] = [];
  const resolveGate = creatorGateResolver({
    organizationId: owner.organizationId,
    sessionRowId: owner.session.id,
    createdByUserId: owner.session.createdByUserId,
    permissionMode: owner.session.permissionMode,
  });
  for (const gate of collectUnresolvedGates(events.reverse())) {
    if (!ids.has(gate.toolUseId)) continue;
    const answer = await applyGatePolicy(client, anthropicSessionId, gate, resolveGate);
    outcomes.push(answer);
  }
  return outcomes;
}

// Only the current idle's blocking IDs can execute. Bound history reads so a corrupt ID cannot walk an entire session.
async function readActionEvents(
  client: ReturnType<typeof requireAnthropicClient>,
  sessionId: string,
  ids: ReadonlySet<string>,
) {
  const missing = new Set(ids);
  const events = [];
  let cursor: string | undefined;
  for (let index = 0; index < 10 && missing.size > 0; index++) {
    const page = await client.beta.sessions.events.list(
      sessionId,
      {
        order: 'desc',
        limit: 200,
        page: cursor,
        types: [
          'agent.custom_tool_use',
          'user.custom_tool_result',
          'agent.tool_use',
          'agent.mcp_tool_use',
          'user.tool_confirmation',
          'agent.tool_result',
          'agent.mcp_tool_result',
        ],
      },
      { timeout: 30_000 },
    );
    for (const event of page.data) {
      events.push(event);
      missing.delete(event.id);
    }
    if (!page.next_page) break;
    cursor = page.next_page;
  }
  if (missing.size > 0)
    throw new AppError(
      'EXTERNAL_API_FAILED',
      'Current session actions are absent from bounded history',
      { sessionId, eventIds: [...missing] },
    );
  return events;
}
