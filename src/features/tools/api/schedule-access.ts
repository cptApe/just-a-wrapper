import 'server-only';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session, task, user, workspace } from '@/db/schema';
import type { AgentTier } from '@/features/agents';
import { resolveEffectiveTimeZone } from '@/features/preferences/lib/time-preferences';
import { ToolError } from '@/lib/errors';
import { logger } from '@/lib/logger';
export async function getScheduleAccess(input: { taskId: string; workspaceId: string }) {
  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      createdByUserId: task.createdByUserId,
      visibility: task.visibility,
      triggerType: task.triggerType,
      status: task.status,
      nextRunAt: task.nextRunAt,
      cronSchedule: task.cronSchedule,
      eventType: task.eventType,
      runAt: task.runAt,
      lastRunAt: task.lastRunAt,
      timezone: task.timezone,
      successCriteria: task.successCriteria,
    })
    .from(task)
    .where(
      and(
        eq(task.id, input.taskId),
        eq(task.workspaceId, input.workspaceId),
        ne(task.status, 'removed'),
      ),
    )
    .limit(1);
  const row = rows.at(0);
  if (!row) return null;
  const latestRuns = row.successCriteria
    ? await db
        .select({ reviewOutcome: session.reviewOutcome })
        .from(session)
        .where(
          and(
            eq(session.taskId, row.id),
            eq(session.kind, 'task_run'),
            inArray(session.status, ['idle', 'terminated']),
          ),
        )
        .orderBy(
          sql`coalesce(${session.endedAt}, ${session.lastEventAt}, ${session.createdAt}) desc`,
          desc(session.createdAt),
        )
        .limit(1)
    : [];
  return {
    ...row,
    latestReviewOutcome: latestRuns.at(0)?.reviewOutcome ?? null,
  };
}
// The organization, tier and timezone a schedule tool call creates schedules under.
export async function resolveScheduleContext(input: {
  workspaceId: string;
  userId: string;
  sessionRowId: string;
  includeTimeZone: boolean;
}): Promise<{ organizationId: string; tier: AgentTier; timezone?: string }> {
  const rows = await db
    .select({ organizationId: workspace.organizationId, tier: session.tier })
    .from(workspace)
    .leftJoin(
      session,
      and(eq(session.id, input.sessionRowId), eq(session.workspaceId, workspace.id)),
    )
    .where(eq(workspace.id, input.workspaceId))
    .limit(1);
  const row = rows.at(0);
  if (!row) {
    throw new ToolError('WORKSPACE_NOT_FOUND', 'Workspace not found', {
      workspaceId: input.workspaceId,
    });
  }
  const caller = { organizationId: row.organizationId, tier: row.tier ?? 'default' };
  if (!input.includeTimeZone) return caller;
  const userRows = await db
    .select({ timezone: user.timezone, browserTimezone: user.browserTimezone })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  return {
    ...caller,
    timezone: resolveEffectiveTimeZone(userRows.at(0) ?? {}, logger()),
  };
}
