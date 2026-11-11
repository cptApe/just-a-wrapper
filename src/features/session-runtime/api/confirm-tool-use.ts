import 'server-only';
import {
  allowToolGloballyForMember,
  rememberToolApprovalForSession,
} from '@/features/permissions/api/approval-scopes';
import {
  anthropicEventPoster,
  listOpenAnthropicGates,
} from '@/features/sessions/api/anthropic-events';
import { assertSessionActor } from '@/features/sessions/api/assert-session-actor';
import type { SessionWriteGrant } from '@/features/sessions/api/session-access';
import type { UnresolvedGate } from '@/features/sessions/lib/relay-translator';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';

type GateDecision =
  | { toolUseId: string; result: 'deny'; threadId?: string }
  | {
      toolUseId: string;
      result: 'allow';
      scope: 'once' | 'session' | 'always';
      threadId?: string;
    };

export type GateConfirmOutcome =
  | { toolUseId: string; status: 'failed' }
  | {
      toolUseId: string;
      status: 'sent';
      scopeStatus?: 'remembered' | 'failed';
    };

export type ConfirmToolUsesArgs = {
  grant: SessionWriteGrant;
  decisions: GateDecision[];
};

export async function confirmToolUses(args: ConfirmToolUsesArgs): Promise<GateConfirmOutcome[]> {
  const { grant } = args;
  // Approval runs the tool as the creator; the automatic gate path applies the same rule.
  await assertSessionActor(grant.sessionRowId, grant.createdByUserId);
  let gates: ReturnType<typeof listOpenAnthropicGates> | undefined;
  const outcomes: GateConfirmOutcome[] = [];
  for (const decision of args.decisions) {
    try {
      let gate: UnresolvedGate | undefined;
      if (decision.result === 'allow' && decision.scope !== 'once') {
        gates ??= listOpenAnthropicGates(grant.anthropicSessionId);
        gate = (await gates).get(decision.toolUseId);
        if (!gate)
          throw new AppError('VALIDATION_FAILED', 'Tool gate is no longer open', {
            sessionId: grant.sessionRowId,
            toolUseId: decision.toolUseId,
          });
      }
      // Persist scope only after Anthropic accepts the authoritative open gate.
      await anthropicEventPoster.postToolConfirmation({
        sessionId: grant.anthropicSessionId,
        toolUseId: decision.toolUseId,
        result: decision.result,
        threadId: decision.threadId ?? gate?.threadId,
      });
      const scopeStatus =
        decision.result === 'allow' && decision.scope !== 'once' && gate
          ? await rememberScope(grant, decision.scope, gate)
          : undefined;
      outcomes.push({
        toolUseId: decision.toolUseId,
        status: 'sent',
        ...(scopeStatus ? { scopeStatus } : {}),
      });
    } catch (error) {
      // This batch boundary returns each failure to the confirmation UI independently.
      captureException(error, {
        feature: 'sessions',
        op: 'confirm-tool-use',
        toolUseId: decision.toolUseId,
        scope: decision.result === 'allow' ? decision.scope : 'deny',
      });
      outcomes.push({ toolUseId: decision.toolUseId, status: 'failed' });
    }
  }
  return outcomes;
}

async function rememberScope(
  grant: SessionWriteGrant,
  scope: 'session' | 'always',
  gate: UnresolvedGate,
): Promise<'remembered' | 'failed'> {
  try {
    if (scope === 'session')
      await rememberToolApprovalForSession({
        sessionId: grant.sessionRowId,
        toolName: gate.toolName,
        toolInput: gate.toolInput,
      });
    else
      await allowToolGloballyForMember({
        organizationId: grant.organizationId,
        userId: grant.userId,
        toolName: gate.toolName,
        toolInput: gate.toolInput,
      });
    return 'remembered';
  } catch (error) {
    // An accepted upstream gate stays answered; report persistence failure separately in the UI.
    captureException(error, {
      feature: 'sessions',
      op: 'remember-tool-approval',
      toolUseId: gate.toolUseId,
      scope,
    });
    return 'failed';
  }
}
