import 'server-only';
import {
  type BuiltinToolGate,
  decideBuiltinToolGate,
  isConfigurableCustomTool,
  resolveCustomToolPolicy,
} from '@/features/permissions';
import { assertSessionActor } from '@/features/sessions/api/assert-session-actor';
import type {
  DispatchContext,
  DispatchOutcome,
  ParkedToolCall,
  ToolCall,
} from '@/features/tool-catalog/types';
import { AuthorizationError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import type { BoundTool, PreparedTool } from '../lib/bind-tool';
import { getCustomTool } from './registry';
import { storeAndDeliver } from './tool-delivery';

type PreparedGate = {
  gate: BuiltinToolGate | 'forbidden';
  tool: BoundTool;
  prepared: PreparedTool;
};

// Always post a result: a missing result hangs the session until its 30-day expiry.
// Ask-gated destructive calls instead park a confirmation; the confirm endpoint posts later.
export async function dispatchCustomTool(
  call: ToolCall,
  ctx: DispatchContext,
  preparedGates: ReadonlyMap<string, PreparedGate>,
): Promise<DispatchOutcome> {
  const preparedGate = preparedGates.get(call.toolUseId);
  if (preparedGate?.gate === 'forbidden')
    return postInvalidTool(call, ctx, {
      code: 'FORBIDDEN',
      message: 'The task creator cannot act in this workspace.',
    });
  if (preparedGate?.gate === 'park')
    return { toolUseId: call.toolUseId, name: call.name, status: 'pending' };
  const tool = preparedGate ? preparedGate.tool : await getCustomTool(call.name);

  if (!tool)
    return postInvalidTool(call, ctx, {
      code: 'TOOL_NOT_FOUND',
      message: `No enabled tool '${call.name}'`,
    });

  const parsed = preparedGate
    ? { success: true as const, data: preparedGate.prepared }
    : tool.prepare(call.input);
  if (!parsed.success)
    return postInvalidTool(call, ctx, {
      code: 'TOOL_INPUT_INVALID',
      issues: parsed.error.flatten(),
    });

  if (preparedGate?.gate === 'block') return postBlockedTool(call, ctx, tool);

  const { runAndPost } = await import('./dispatch-execution');
  return runAndPost(tool, parsed.data, call.toolUseId, ctx);
}

// Resolve parked calls before the claim transaction so claims and confirmations are atomic.
export async function prepareCustomToolDispatchGates(
  calls: ToolCall[],
  ctx: DispatchContext,
): Promise<{
  parkedCalls: ParkedToolCall[];
  gates: ReadonlyMap<string, PreparedGate>;
}> {
  let canAct = true;
  try {
    await assertSessionActor(ctx.sessionRowId, ctx.actorUserId);
  } catch (cause) {
    if (!(cause instanceof AuthorizationError)) throw cause;
    canAct = false;
  }
  const prepared = await Promise.all(
    calls.map(
      async (
        call,
      ): Promise<{
        call: ToolCall;
        gate: PreparedGate;
        parked: ParkedToolCall | null;
      } | null> => {
        const tool = await getCustomTool(call.name);
        if (!tool) return null;
        const parsed = tool.prepare(call.input);
        if (!parsed.success) return null;
        const policy = isConfigurableCustomTool(tool.name)
          ? await resolveCustomToolPolicy({
              organizationId: ctx.organizationId,
              userId: ctx.actorUserId,
              toolName: tool.name,
            })
          : null;
        const gate: PreparedGate = {
          gate: canAct
            ? decideBuiltinToolGate({ policy, alwaysAsk: tool.alwaysAsk === true })
            : 'forbidden',
          tool,
          prepared: parsed.data,
        };
        if (gate.gate !== 'park') return { call, gate, parked: null };
        return {
          call,
          gate,
          parked: {
            toolUseId: call.toolUseId,
            name: call.name,
            input: parsed.data.input,
            workspaceId: ctx.workspaceId,
            requestedByUserId: ctx.actorUserId,
          },
        };
      },
    ),
  );
  const gates = new Map<string, PreparedGate>();
  const parkedCalls: ParkedToolCall[] = [];
  prepared.forEach((result) => {
    if (!result) return;
    const { call } = result;
    gates.set(call.toolUseId, result.gate);
    if (result.parked) parkedCalls.push(result.parked);
  });
  return { parkedCalls, gates };
}

export async function dispatchBatch(
  calls: ToolCall[],
  ctx: DispatchContext,
  preparedGates: ReadonlyMap<string, PreparedGate>,
): Promise<DispatchOutcome[]> {
  return Promise.all(
    calls.map(async (call): Promise<DispatchOutcome> => {
      try {
        return await dispatchCustomTool(call, ctx, preparedGates);
      } catch (reason) {
        captureException(reason, {
          feature: 'tooling',
          op: 'dispatch-batch',
          toolUseId: call.toolUseId,
        });
        return {
          toolUseId: call.toolUseId,
          name: call.name,
          status: 'retry',
          detail: 'DELIVERY_PENDING',
        };
      }
    }),
  );
}

async function postBlockedTool(
  call: ToolCall,
  ctx: DispatchContext,
  tool: BoundTool,
): Promise<DispatchOutcome> {
  // A user-chosen Block is a normal refusal, not an error (never an AppError):
  // the agent gets a plain-english result it can relay, and isError stays false
  // so the model does not treat it as a failure to retry.
  return storeAndDeliver(ctx, call.toolUseId, {
    isError: false,
    source: 'tool_call',
    detail: 'POLICY_BLOCKED',
    content: {
      blocked: true,
      message: `The "${tool.name}" tool is turned off in your tool permissions, so it did not run. You can allow it in Settings under Tools.`,
    },
  });
}

async function postInvalidTool(
  call: ToolCall,
  ctx: DispatchContext,
  content: { code: string; message?: string; issues?: unknown },
): Promise<DispatchOutcome> {
  return storeAndDeliver(ctx, call.toolUseId, {
    isError: true,
    source: 'tool_call',
    content,
    detail: content.code,
  });
}
