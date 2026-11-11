import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import { sessionReadState } from '@/db/schema';
import type { AgentTier } from '@/features/agents';
import { requireAnthropicClient } from '@/features/agents';
import { assertCanStartChat } from '@/features/billing/api/assert-plan-limits';
import { sessionBudgetForWorkspace } from '@/features/billing/api/session-budget';
import { assertCanSpend } from '@/features/billing/api/spend-gate';
import { WORKSPACE_STORE_INSTRUCTIONS } from '@/features/memory/lib/memory';
import { createManagedChatSession } from '@/features/sessions/api/create-managed-chat-session';
import {
  attachCreatedSession,
  failSessionCreation,
  insertSession,
} from '@/features/sessions/api/session-transitions';
import { isSessionSendRefused } from '@/features/sessions/lib/session-send-refusal';
import { UNTITLED_SESSION_TITLE } from '@/features/sessions/lib/untitled-session-title';
import { captureEvent } from '@/lib/analytics';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { DurableRecoveryError } from '@/lib/recover-rows';
import { extend } from '@/lib/request-context';
import {
  type DispatchPendingToolCalls,
  reconcileWorkspaceSessions,
} from './reconcile-stale-sessions';
import { resolveSessionCreateContext } from './session-create-context';
import { sendOpeningMessage } from './start-turn';

// Share session creation and opening messages across chat and task runs.
// The relay replays full history so browser attachment cannot miss the opening events.
// Deadline creation at 90s and set maxRetries:0: upstream creates are not idempotent.

type StartChatInput = {
  tier: AgentTier;
  message: string;
  title?: string;
  /** Owning workspace — resolved at the route boundary (resolveCaller). */
  workspaceId: string;
  createdByUserId: string;
  /** Owning organization from resolveCaller, for attaching the creator
   * and workspace memory stores. Omit stores without provisioned upstream ids. */
  organizationId: string;
  permissionMode: 'ask' | 'auto';
  /** Create the sandbox and ownership row without starting an agent turn. */
  deferInitialMessage: boolean;
  /** Trusted server-only attribution for app-initiated sessions. */
} & (
  | { kind: 'chat'; dispatchPendingToolCalls: DispatchPendingToolCalls }
  | {
      kind: 'task_run';
      taskRun: {
        taskId: string;
        sessionId: string;
        visibility: 'private' | 'workspace';
      };
    }
);

// Home defers the opening turn until attachments are mounted. Clients receive the local UUID; only
// server callers receive the upstream ID.
export async function startChatSession(
  input: StartChatInput,
): Promise<{ sessionId: string; anthropicSessionId: string }> {
  if (input.kind === 'chat') {
    // A person opening a chat reads the refusal; event runs pass the gate when their delivery is claimed.
    await assertCanSpend({
      entry: 'chat_start',
      workspaceId: input.workspaceId,
      userId: input.createdByUserId,
    });
    // One unrecoverable older session must not stop new work; the capacity check below still holds.
    await reconcileWorkspaceSessions({
      workspaceId: input.workspaceId,
      rateLimit: true,
      dispatchPendingToolCalls: input.dispatchPendingToolCalls,
    }).catch((error: unknown) => {
      if (!(error instanceof DurableRecoveryError)) throw error;
      captureException(error, { op: 'start-chat-reconcile', workspaceId: input.workspaceId });
    });
    // Refuse full workspaces before provider work; the ownership insert rechecks under the same capacity lock.
    await db.transaction((tx) => assertCanStartChat(input.workspaceId, tx));
  }
  const client = requireAnthropicClient();

  const title = input.title ?? UNTITLED_SESSION_TITLE;
  const context = await resolveSessionCreateContext(client, {
    target: 'session',
    tier: input.tier,
    workspaceId: input.workspaceId,
    createdByUserId: input.createdByUserId,
    organizationId: input.organizationId,
  });
  // Ownership is durable before the non-idempotent provider call; the opening event follows attachment.
  const appSessionId = input.kind === 'task_run' ? input.taskRun.sessionId : randomUUID();
  await persistSessionOwnership(
    input,
    { appSessionId, title },
    context.resources.find((resource) =>
      resource.instructions.startsWith(WORKSPACE_STORE_INSTRUCTIONS),
    )?.access ?? 'none',
  );
  let anthropicSessionId: string | null = null;
  let openingAttempted = false;
  try {
    const session = await createManagedChatSession(client, {
      agent: context.agent,
      environmentId: context.environmentId,
      budget: await sessionBudgetForWorkspace(
        input.workspaceId,
        input.kind === 'task_run' ? input.createdByUserId : null,
      ),
      title,
      workspaceId: input.workspaceId,
      createdByUserId: input.createdByUserId,
      appSessionId,
      taskId: input.kind === 'task_run' ? input.taskRun.taskId : null,
      resources: context.resources,
      vaultIds: context.vaultIds,
    });
    anthropicSessionId = session.id;
    extend({ session_id: session.id });
    const attached = await attachCreatedSession(appSessionId, session.id, {
      deferred: input.deferInitialMessage,
    });
    if (!attached)
      throw new AppError('CONFLICT', 'Session creation lost its ownership claim', { appSessionId });
    if (!input.deferInitialMessage) {
      openingAttempted = true;
      await sendOpeningMessage({
        sessionId: appSessionId,
        anthropicSessionId: session.id,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        userId: input.createdByUserId,
        text: input.message,
        // Scheduled and event runs are app actions, not product activity.
        origin: input.kind === 'chat' ? 'user' : 'system',
        claim: attached.stateVersion,
      });
    }
  } catch (cause) {
    if (!openingAttempted || isSessionSendRefused(cause)) {
      await db.transaction((tx) => failSessionCreation(tx, appSessionId, anthropicSessionId, null));
    }
    throw new AppError(
      'EXTERNAL_API_FAILED',
      'Session start could not be confirmed; recovery is pending',
      { appSessionId },
      { cause },
    );
  }
  captureSessionCreated(input, appSessionId);
  return { sessionId: appSessionId, anthropicSessionId };
}

async function persistSessionOwnership(
  input: StartChatInput,
  created: { appSessionId: string; title: string },
  workspaceMemoryAccess: 'none' | 'read_only' | 'read_write',
): Promise<void> {
  const createdAt = new Date();
  return db.transaction(async (tx) => {
    if (input.kind === 'chat') await assertCanStartChat(input.workspaceId, tx);
    await insertSession(tx, {
      id: created.appSessionId,
      workspaceMemoryAccess,
      workspaceId: input.workspaceId,
      createdByUserId: input.createdByUserId,
      tier: input.tier,
      kind: input.kind,
      ...(input.kind === 'task_run'
        ? {
            taskId: input.taskRun.taskId,
            visibility: input.taskRun.visibility,
            startedAt: createdAt,
          }
        : {}),
      permissionMode: input.permissionMode,
      title: created.title,
      status: 'creating',
      lastEventAt: createdAt,
    });
    if (input.kind === 'chat')
      await tx.insert(sessionReadState).values({
        workspaceId: input.workspaceId,
        sessionId: created.appSessionId,
        userId: input.createdByUserId,
        lastReadAt: createdAt,
      });
  });
}

function captureSessionCreated(input: StartChatInput, appSessionId: string): void {
  captureEvent(
    'session:create',
    {
      app_session_id: appSessionId,
      session_kind: input.kind,
      tier: input.tier,
      permission_mode: input.permissionMode,
      has_deferred_message: input.deferInitialMessage,
    },
    { userId: input.createdByUserId, workspaceId: input.workspaceId },
  );
}
