import { sql } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/db';
import { realtimeEvent } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { snapshotCtx, withRequestContext } from '@/lib/request-context';
import { type StoredWorkspaceEvent, workspaceEventSchema } from '@/lib/workspace-event';
import 'server-only';
import { audienceForSessionEvent, type SessionScopedEvent } from '../lib/channel';

export async function publishMemberEvent(
  organizationId: string,
  audienceUserId: string | null,
  event: StoredWorkspaceEvent,
): Promise<void> {
  const parsed = workspaceEventSchema.safeParse(event);
  if (!parsed.success)
    throw new AppError(
      'UNEXPECTED',
      'Invalid workspace event',
      { organizationId },
      { cause: parsed.error },
    );
  const validated = parsed.data;
  // Allocate ids in commit order so a stream cursor cannot skip an earlier uncommitted row.
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`realtime-event:${organizationId}`}, 0))`,
    );
    await transaction.insert(realtimeEvent).values({
      organizationId,
      audienceUserId,
      type: event.type,
      payload: { ...validated, publishedAt: Date.now() },
    });
  });
}
export async function publishWorkspaceEvent(
  organizationId: string,
  event: StoredWorkspaceEvent,
): Promise<void> {
  await publishMemberEvent(organizationId, null, event);
}
export type PublishSessionScope = {
  organizationId: string;
  session: { visibility: 'private' | 'workspace'; createdByUserId: string };
};
export async function publishSessionEvent(
  event: SessionScopedEvent,
  scope: PublishSessionScope,
): Promise<void> {
  await publishMemberEvent(scope.organizationId, audienceForSessionEvent(event, scope), event);
}
// Publish after the response so realtime failures cannot roll back the accompanying task mutation.
export function schedulePublishSessionEvent(
  event: SessionScopedEvent,
  scope: PublishSessionScope,
): void {
  const snapshot = snapshotCtx();
  after(() =>
    withRequestContext(snapshot, () => publishSessionEvent(event, scope)).catch((error: unknown) =>
      captureException(error, { op: 'realtime-publish' }),
    ),
  );
}
