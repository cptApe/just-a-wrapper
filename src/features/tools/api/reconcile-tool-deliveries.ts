import 'server-only';
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { customToolDispatch, session } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { TOOL_EXECUTION_LEASE_MS } from '../lib/tool-delivery-machine';
import { recoverStoredToolDelivery } from './tool-delivery';
import { claimDeliveredRecovery } from './tool-delivery-transitions';

// A call awaiting a decision is not in the list, so a waiting approval is never answered here.
export async function reconcileToolDeliveries(): Promise<void> {
  const rows = await db
    .select({
      dispatch: customToolDispatch,
      upstreamId: sql<string>`${session.anthropicSessionId}`,
    })
    .from(customToolDispatch)
    .innerJoin(session, eq(session.id, customToolDispatch.sessionId))
    .where(
      and(
        inArray(customToolDispatch.status, [
          'ready',
          'delivering',
          'delivered',
          'claimed',
          'executing',
        ]),
        lt(customToolDispatch.updatedAt, new Date(Date.now() - TOOL_EXECUTION_LEASE_MS)),
        isNotNull(session.anthropicSessionId),
      ),
    )
    .orderBy(customToolDispatch.updatedAt)
    .limit(25);
  const outcomes = await Promise.allSettled(
    rows.map(async ({ dispatch, upstreamId }) => {
      if (dispatch.status === 'delivered' && !(await claimDeliveredRecovery(dispatch))) return;
      await recoverStoredToolDelivery(
        { sessionRowId: dispatch.sessionId, anthropicSessionId: upstreamId },
        dispatch,
      );
    }),
  );
  const failures = outcomes.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AppError(
      'EXTERNAL_API_FAILED',
      'Tool deliveries remain pending',
      {
        failures: failures.length,
      },
      { cause: new AggregateError(failures) },
    );
}
