import 'server-only';
import { and, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { customToolDispatch, member, session, workspace } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { recoverRows } from '@/lib/recover-rows';
import { recoverToolDelivery } from './tool-delivery';
import { expireToolDecisions } from './tool-delivery-transitions';

// Departed creators cannot open private tasks to drive recovery from the browser.
export async function recoverRemovedCreatorTools(deadline: number): Promise<void> {
  const owners = await db
    .selectDistinct({ id: session.id, anthropicSessionId: session.anthropicSessionId })
    .from(session)
    .innerJoin(workspace, eq(workspace.id, session.workspaceId))
    .leftJoin(
      member,
      and(
        eq(member.organizationId, workspace.organizationId),
        eq(member.userId, session.createdByUserId),
      ),
    )
    .innerJoin(customToolDispatch, eq(customToolDispatch.sessionId, session.id))
    .where(
      and(
        isNull(member.id),
        isNotNull(session.anthropicSessionId),
        notInArray(customToolDispatch.status, ['completed', 'abandoned']),
      ),
    )
    .orderBy(session.id)
    .limit(25);
  await recoverRows(
    owners,
    async (owner) => {
      if (owner.anthropicSessionId === null) return;
      await expireToolDecisions(owner.id);
      const deliveries = await db
        .select({ toolUseId: customToolDispatch.toolUseId })
        .from(customToolDispatch)
        .where(
          and(
            eq(customToolDispatch.sessionId, owner.id),
            notInArray(customToolDispatch.status, ['completed', 'abandoned']),
          ),
        )
        .orderBy(sql`${customToolDispatch.updatedAt} asc`);
      for (const delivery of deliveries) {
        const outcome = await recoverToolDelivery(
          { sessionRowId: owner.id, anthropicSessionId: owner.anthropicSessionId },
          delivery.toolUseId,
        );
        if (outcome.status !== 'posted')
          throw new AppError(
            'EXTERNAL_API_FAILED',
            'Removed creator tool result still needs delivery',
            { sessionId: owner.id, toolUseId: delivery.toolUseId },
          );
      }
    },
    { deadline },
  );
}
