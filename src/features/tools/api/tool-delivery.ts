import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { session } from '@/db/schema';
import { accrueToolCall } from '@/features/billing/api/accrue-tool-call';
import { pauseSessionForInsufficientCredits } from '@/features/billing/api/pause-session-on-exhaustion';
import { resolveMediaCost } from '@/features/billing/api/resolve-media-cost';
import { creditsForVendorCents } from '@/features/billing/lib/credit-math';
import { anthropicEventPoster } from '@/features/sessions/api/anthropic-events';
import type { DispatchOutcome } from '@/features/tool-catalog/types';
import { captureEvent } from '@/lib/analytics';
import { AppError } from '@/lib/errors';
import { capabilities } from '@/lib/runtime-capabilities';
import {
  TOOL_EXECUTION_LEASE_MS,
  type ToolDelivery,
  toolDeliverySchema,
} from '../lib/tool-delivery-machine';
import { moveToolDelivery, readToolDelivery } from './tool-delivery-transitions';

type DeliveryContext = { sessionRowId: string; anthropicSessionId: string };
type ToolDeliveryRow = NonNullable<Awaited<ReturnType<typeof readToolDelivery>>>;

export async function storeAndDeliver(
  ctx: DeliveryContext,
  toolUseId: string,
  delivery: ToolDelivery,
): Promise<DispatchOutcome> {
  const stored = await moveToolDelivery({
    sessionId: ctx.sessionRowId,
    toolUseId,
    to: 'ready',
    delivery,
    staleBefore: null,
  });
  return stored ? deliverStoredTool(ctx, toolUseId) : recoverToolDelivery(ctx, toolUseId);
}

async function accrueDelivery(
  ctx: DeliveryContext,
  toolUseId: string,
  toolName: string,
  delivery: ToolDelivery,
): Promise<number | undefined> {
  const vendorCostCents = delivery.mediaBilling
    ? await resolveMediaCost(capabilities.media, delivery.mediaBilling)
    : delivery.vendorCostCents;
  if (vendorCostCents !== undefined && vendorCostCents > 0)
    await accrueToolCall({
      anthropicSessionId: ctx.anthropicSessionId,
      toolUseId,
      toolName,
      vendorCostCents,
      source: delivery.source,
    });
  return vendorCostCents;
}

// An expired executor has an unknown external outcome. Never repeat its side effect.
export async function recoverToolDelivery(
  ctx: DeliveryContext,
  toolUseId: string,
): Promise<DispatchOutcome> {
  const row = await readToolDelivery(ctx.sessionRowId, toolUseId);
  if (!row) throw new AppError('CONFLICT', 'Tool delivery claim is missing', { toolUseId });
  return recoverStoredToolDelivery(ctx, row);
}

export async function recoverStoredToolDelivery(
  ctx: DeliveryContext,
  row: ToolDeliveryRow,
): Promise<DispatchOutcome> {
  const toolUseId = row.toolUseId;
  if (row.status === 'awaiting_decision')
    return { toolUseId, name: row.toolName, status: 'pending' };
  if (row.status === 'claimed' || row.status === 'executing') {
    const moved = await moveToolDelivery({
      sessionId: ctx.sessionRowId,
      toolUseId,
      to: 'ready',
      staleBefore: new Date(Date.now() - TOOL_EXECUTION_LEASE_MS),
      delivery: {
        isError: true,
        source: 'tool_call',
        detail: 'EXECUTION_INTERRUPTED',
        content: {
          code: 'EXECUTION_INTERRUPTED',
          message:
            'The tool execution was interrupted. Its outcome is unknown; check the result before trying this action again.',
        },
      },
    });
    if (!moved) return { toolUseId, name: row.toolName, status: 'retry', detail: 'EXECUTING' };
    return deliverStoredTool(ctx, toolUseId);
  }
  return deliverToolRecord(ctx, row);
}

export async function deliverStoredTool(
  ctx: DeliveryContext,
  toolUseId: string,
): Promise<DispatchOutcome> {
  const row = await readToolDelivery(ctx.sessionRowId, toolUseId);
  if (!row) throw new AppError('CONFLICT', 'Tool delivery claim is missing', { toolUseId });
  return deliverToolRecord(ctx, row);
}

async function deliverToolRecord(
  ctx: DeliveryContext,
  row: ToolDeliveryRow,
): Promise<DispatchOutcome> {
  const toolUseId = row.toolUseId;
  if (row.status === 'completed' || row.status === 'abandoned')
    return {
      toolUseId,
      name: row.toolName,
      status: 'posted',
      isError: false,
      detail: row.status === 'abandoned' ? 'UPSTREAM_UNAVAILABLE' : undefined,
    };
  if (row.status === 'awaiting_decision')
    return { toolUseId, name: row.toolName, status: 'pending' };
  if (row.status === 'claimed' || row.status === 'executing') return retryLater(row, 'EXECUTING');
  if (row.status === 'delivering') {
    const expired = await moveToolDelivery({
      sessionId: ctx.sessionRowId,
      toolUseId,
      to: 'ready',
      delivery: null,
      staleBefore: new Date(Date.now() - TOOL_EXECUTION_LEASE_MS),
    });
    if (!expired) return retryLater(row, 'DELIVERING');
    return deliverStoredTool(ctx, toolUseId);
  }
  const delivery = toolDeliverySchema.parse(row.delivery);
  if (row.status === 'ready') {
    const stopped = await postReadyDelivery(ctx, row, delivery);
    if (stopped) return stopped;
  }
  await completeDelivery(ctx, row, delivery);
  return {
    toolUseId,
    name: row.toolName,
    status: 'posted',
    isError: delivery.isError,
    ...(delivery.detail ? { detail: delivery.detail } : {}),
  };
}

function retryLater(row: ToolDeliveryRow, detail: 'EXECUTING' | 'DELIVERING'): DispatchOutcome {
  return { toolUseId: row.toolUseId, name: row.toolName, status: 'retry', detail };
}

function moveDeliveryStatus(
  ctx: DeliveryContext,
  toolUseId: string,
  to: 'ready' | 'delivering' | 'delivered' | 'completed' | 'abandoned',
): Promise<boolean> {
  return moveToolDelivery({
    sessionId: ctx.sessionRowId,
    toolUseId,
    to,
    delivery: null,
    staleBefore: null,
  });
}

// Returns the outcome when delivery stops here, or null once the result reached the session.
async function postReadyDelivery(
  ctx: DeliveryContext,
  row: ToolDeliveryRow,
  delivery: ToolDelivery,
): Promise<DispatchOutcome | null> {
  const toolUseId = row.toolUseId;
  if (!(await moveDeliveryStatus(ctx, toolUseId, 'delivering')))
    return retryLater(row, 'DELIVERING');
  try {
    const delivered = await anthropicEventPoster.isToolResultDelivered(ctx.anthropicSessionId, {
      toolUseId,
      name: row.toolName,
    });
    if (delivered === 'unavailable') {
      await accrueDelivery(ctx, toolUseId, row.toolName, delivery);
      await moveDeliveryStatus(ctx, toolUseId, 'abandoned');
      return {
        toolUseId,
        name: row.toolName,
        status: 'posted',
        isError: false,
        detail: 'UPSTREAM_UNAVAILABLE',
      };
    }
    if (!delivered)
      await anthropicEventPoster.postCustomToolResult({
        sessionId: ctx.anthropicSessionId,
        toolUseId,
        isError: delivery.isError,
        content: delivery.content,
      });
  } catch (cause) {
    // A failed send may have arrived. The next claim reconciles upstream before posting.
    await moveDeliveryStatus(ctx, toolUseId, 'ready');
    throw cause;
  }
  if (!(await moveDeliveryStatus(ctx, toolUseId, 'delivered')))
    return retryLater(row, 'DELIVERING');
  return null;
}

async function completeDelivery(
  ctx: DeliveryContext,
  row: ToolDeliveryRow,
  delivery: ToolDelivery,
): Promise<void> {
  const vendorCostCents = await accrueDelivery(ctx, row.toolUseId, row.toolName, delivery);
  if (delivery.detail === 'CREDITS_EXHAUSTED')
    await pauseSessionForInsufficientCredits(ctx.anthropicSessionId);
  if (!(await moveDeliveryStatus(ctx, row.toolUseId, 'completed'))) return;
  const owner = (
    await db
      .select({ userId: session.createdByUserId, workspaceId: session.workspaceId })
      .from(session)
      .where(eq(session.id, ctx.sessionRowId))
  ).at(0);
  if (owner)
    captureEvent(
      delivery.isError ? 'tool:call_fail' : 'tool:call_complete',
      {
        tool_name: row.toolName,
        duration_ms: Date.now() - row.createdAt.getTime(),
        credits: vendorCostCents === undefined ? 0 : creditsForVendorCents(vendorCostCents),
        ...(delivery.detail ? { failure_kind: delivery.detail } : {}),
      },
      { userId: owner.userId, workspaceId: owner.workspaceId },
    );
}
