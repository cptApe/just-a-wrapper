import 'server-only';
import { assertCanSpend } from '@/features/billing/api/spend-gate';
import { resolveToolSettings } from '@/features/permissions/api/custom-tool-policy';
import { assertSessionActor } from '@/features/sessions/api/assert-session-actor';
import type { DispatchContext, DispatchOutcome } from '@/features/tool-catalog/types';
import { isExpectedUserStateError } from '@/lib/expected-state-error';
import { captureException } from '@/lib/observability';
import type { BoundTool, PreparedTool } from '../lib/bind-tool';
import { PaidToolError } from '../lib/paid-tool-error';
import { stripReservedBillingFields } from '../lib/reserved-fields';
import type { ToolDelivery } from '../lib/tool-delivery-machine';
import { toolErrorContent } from '../lib/tool-error-content';
import { recoverToolDelivery, storeAndDeliver } from './tool-delivery';
import { moveToolDelivery } from './tool-delivery-transitions';

export async function runAndPost(
  tool: BoundTool,
  prepared: PreparedTool,
  toolUseId: string,
  ctx: Omit<DispatchContext, 'organizationId'>,
): Promise<DispatchOutcome> {
  const claimed = await moveToolDelivery({
    sessionId: ctx.sessionRowId,
    toolUseId,
    to: 'executing',
    delivery: null,
    staleBefore: null,
  });
  if (!claimed) return recoverToolDelivery(ctx, toolUseId);
  let delivery: ToolDelivery;
  try {
    await assertSessionActor(ctx.sessionRowId, ctx.actorUserId);
    await assertToolCanSpend(tool, prepared, ctx);
    const execution = await prepared.run({
      workspaceId: ctx.workspaceId,
      userId: ctx.actorUserId,
      sessionId: ctx.anthropicSessionId,
      sessionRowId: ctx.sessionRowId,
    });
    delivery = {
      isError: false,
      content: stripReservedBillingFields(execution.output),
      vendorCostCents: execution.vendorCostCents,
      mediaBilling: execution.mediaBilling,
      source: tool.accrualSource,
    };
  } catch (cause) {
    const content = toolErrorContent(cause);
    // The agent's own bad input and a spend refusal reach the agent as its result; neither is an incident.
    if (!isExpectedUserStateError(cause) && content.code !== 'TOOL_INPUT_INVALID')
      captureException(cause, { feature: 'tooling', tool: tool.name });
    delivery = {
      isError: true,
      content,
      detail: content.code,
      source: tool.accrualSource,
      // A provider that charged before the failure is billed like a success.
      ...(cause instanceof PaidToolError ? cause.cost : {}),
    };
  }
  return storeAndDeliver(ctx, toolUseId, delivery);
}

// The one spend check for tools: a refusal reaches the agent as the tool's error result.
async function assertToolCanSpend(
  tool: BoundTool,
  prepared: PreparedTool,
  ctx: Omit<DispatchContext, 'organizationId'>,
): Promise<void> {
  if (!prepared.estimateCredits) return;
  const settings = await resolveToolSettings({
    workspaceId: ctx.workspaceId,
    userId: ctx.actorUserId,
    toolName: tool.name,
  });
  await assertCanSpend({
    entry: 'tool',
    workspaceId: ctx.workspaceId,
    userId: ctx.actorUserId,
    credits: prepared.estimateCredits(settings),
  });
}
