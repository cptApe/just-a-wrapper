import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable, task as taskTable, workspace } from '@/db/schema';
import { notificationChannels } from '@/features/notifications/lib/task-notification';
import { captureException } from '@/lib/observability';
import { notify } from './notify';

// Relay and webhook delivery can describe the same occurrence; eventId deduplicates them.
// Only shared tasks notify the workspace; private titles stay with their creator.
// This boundary reports failures without interrupting task streaming or causing webhook retries.
type TaskNudge = 'task.completed' | 'task.failed' | 'task.needs_input';

export async function notifyTaskEvent(input: {
  anthropicSessionId: string;
  event: TaskNudge;
  eventId: string;
}): Promise<void> {
  try {
    const row = (
      await db
        .select({
          id: sessionTable.id,
          kind: sessionTable.kind,
          visibility: sessionTable.visibility,
          title: sessionTable.title,
          createdByUserId: sessionTable.createdByUserId,
          organizationId: workspace.organizationId,
          taskNotification: taskTable.notification,
        })
        .from(sessionTable)
        .innerJoin(workspace, eq(sessionTable.workspaceId, workspace.id))
        .leftJoin(taskTable, eq(sessionTable.taskId, taskTable.id))
        .where(eq(sessionTable.anthropicSessionId, input.anthropicSessionId))
        .limit(1)
    ).at(0);
    if (!row) return; // foreign/console session — nothing to nudge
    // A missing schedule must not inherit a chat email preference; its notifications are off.
    const channels =
      row.kind === 'chat' ? null : notificationChannels(row.taskNotification ?? 'off');
    if (channels && !channels.email && !channels.inApp) return;

    const titles: Record<TaskNudge, string> = {
      'task.completed': 'Task completed',
      'task.failed': 'Task failed',
      'task.needs_input': 'A task needs your input',
    };

    await notify(input.event, {
      organizationId: row.organizationId,
      idempotencyKey: `${input.event}:${input.eventId}`,
      recipientUserIds: row.visibility === 'workspace' ? undefined : [row.createdByUserId],
      channels: channels
        ? { inApp: channels.inApp, email: channels.email ? 'force' : 'off' }
        : { inApp: false, email: 'preference' },
      data: {
        // Client links use our UUID, never the upstream session id.
        sessionId: row.id,
        taskTitle: row.title || titles[input.event],
        title: row.title ? `${titles[input.event]}: ${row.title}` : titles[input.event],
      },
    });
  } catch (error) {
    captureException(error, {
      feature: 'notifications',
      op: 'notify-task-event',
      sessionId: input.anthropicSessionId,
      event: input.event,
    });
  }
}

export async function notifyIntegrationBroken(input: {
  anthropicSessionId: string;

  serverName: string;
  eventId: string;
}): Promise<void> {
  try {
    const row = (
      await db
        .select({
          organizationId: workspace.organizationId,
          createdByUserId: sessionTable.createdByUserId,
        })
        .from(sessionTable)
        .innerJoin(workspace, eq(sessionTable.workspaceId, workspace.id))
        .where(eq(sessionTable.anthropicSessionId, input.anthropicSessionId))
        .limit(1)
    ).at(0);
    if (!row) return;

    const slug = input.serverName.trim().toLowerCase();
    await notify('integration.broken', {
      organizationId: row.organizationId,
      idempotencyKey: `integration-broken:${input.eventId}`,
      recipientUserIds: [row.createdByUserId],
      data: {
        slug,
        title: `${input.serverName} needs reconnecting`,
        body: 'The agent could not authenticate with it. Reconnect it on the Tools page.',
      },
    });
  } catch (error) {
    captureException(error, {
      feature: 'notifications',
      op: 'notify-integration-broken',
      sessionId: input.anthropicSessionId,
    });
  }
}
