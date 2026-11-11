import 'server-only';

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspace } from '@/db/schema';
import type { MemoryContext } from '@/features/memory/api/resolve';
import type { MemoryScope } from '@/features/memory/types';
import { startChatSession } from '@/features/session-runtime';
import { dispatchSessionActions } from '@/features/tools/api/dispatch-session-actions';
import { AppError } from '@/lib/errors';

// Ask agent opens a task focused on the chosen memory store and mount.
// Attached session resources supply the actual access; the opening message
// provides context and the resulting transcript records the edits.

const PRIMED_MESSAGE: Record<MemoryScope, string> = {
  you:
    'I want to review and update what you remember about me. ' +
    'Read through your memory about me (everything under /mnt/memory/user), give me a short summary of what you have, ' +
    'and then help me correct, add, or remove things — apply each change to memory as we agree on it, and tell me exactly what you changed.',
  workspace:
    'I want to review and update this workspace’s shared memory. ' +
    'Read through the workspace memory (everything under /mnt/memory/workspace), give me a short summary of what you have, ' +
    'and then help me correct, add, or remove things — apply each change to memory as we agree on it, and tell me exactly what you changed.',
};

const TASK_TITLE: Record<MemoryScope, string> = {
  you: 'Update memory about me',
  workspace: 'Update workspace memory',
};

export async function startMemoryUpdateTask(
  scope: MemoryScope,
  ctx: MemoryContext,
): Promise<{ sessionId: string }> {
  const ws = (
    await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.organizationId, ctx.organizationId))
      .limit(1)
  ).at(0);
  if (!ws) {
    throw new AppError('WORKSPACE_NOT_FOUND', 'no workspace row for active organization', {
      organizationId: ctx.organizationId,
    });
  }
  // "Ask agent to update" opens an interactive chat like any other, so the spend gate and the
  // chats-at-once limit apply inside startChatSession. The memory pane toasts the
  // CREDITS_EXHAUSTED and PLAN_LIMIT_REACHED sentences as written.
  return startChatSession({
    tier: 'default',
    kind: 'chat',
    permissionMode: 'auto',
    deferInitialMessage: false,
    message: PRIMED_MESSAGE[scope],
    title: TASK_TITLE[scope],
    workspaceId: ws.id,
    createdByUserId: ctx.userId,
    organizationId: ctx.organizationId,
    dispatchPendingToolCalls: dispatchSessionActions,
  });
}
