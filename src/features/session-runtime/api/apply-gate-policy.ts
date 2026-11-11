import 'server-only';
import type { getAnthropicClient } from '@/features/agents';
import type { GateOutcome } from '@/features/permissions';
import { gateConfirmation } from '@/features/permissions/lib/resolve';
import { STALL_PROBE_TIMEOUT_MS } from '@/features/sessions/api/stream-stall';
import type { UnresolvedGate } from '@/features/sessions/lib/relay-translator';
import { buildToolConfirmationEvent } from '@/features/sessions/lib/tool-events';
import { captureException } from '@/lib/observability';

// A failed confirmation can be a harmless race with another attached relay.
// Inspect one bounded descending page of confirmations to distinguish that case
// without auto-paginating the session inside the live pump.
const GATE_RECONCILE_LIMIT = 50;
type AnthropicClient = NonNullable<ReturnType<typeof getAnthropicClient>>;

export async function applyGatePolicy(
  client: AnthropicClient,
  sessionId: string,
  gate: UnresolvedGate,
  resolveGate: (toolName: string, toolInput: unknown) => Promise<GateOutcome>,
): Promise<'allow' | 'deny' | 'gate' | 'retry'> {
  // A policy outage must leave the tool gated, never approve it implicitly.
  let outcome: GateOutcome;
  try {
    outcome = await resolveGate(gate.toolName, gate.toolInput);
  } catch (error) {
    captureException(error, {
      sessionId,
      op: 'resolve-gate-policy',
      toolUseId: gate.toolUseId,
      toolName: gate.toolName,
    });
    return 'retry';
  }
  if (outcome === 'gate') return 'gate';
  // The permissions feature owns the answer and the reason the agent reads.
  const confirmation = gateConfirmation(outcome);
  try {
    await client.beta.sessions.events.send(
      sessionId,
      {
        events: [
          buildToolConfirmationEvent({
            toolUseId: gate.toolUseId,
            result: confirmation.result,
            denyMessage: confirmation.denyMessage,
            threadId: gate.threadId,
          }),
        ],
      },
      { timeout: STALL_PROBE_TIMEOUT_MS },
    );
    return confirmation.result;
  } catch (error) {
    captureException(error, {
      sessionId,
      op: 'apply-gate-policy',
      toolUseId: gate.toolUseId,
      toolName: gate.toolName,
    });
    // Another attached relay may have confirmed the same gate first.
    return findRecordedGateConfirmation(client, sessionId, gate.toolUseId, gate.toolName);
  }
}

// Another relay can win the confirmation race. Read the recorded answer before exposing an
// unanswered gate; failed reconciliation leaves it safely gated.
async function findRecordedGateConfirmation(
  client: AnthropicClient,
  sessionId: string,
  toolUseId: string,
  toolName: string,
): Promise<'allow' | 'deny' | 'retry'> {
  try {
    const page = await client.beta.sessions.events.list(
      sessionId,
      { order: 'desc', limit: GATE_RECONCILE_LIMIT, types: ['user.tool_confirmation'] },
      { timeout: STALL_PROBE_TIMEOUT_MS },
    );
    for (const event of page.data) {
      if (event.type === 'user.tool_confirmation' && event.tool_use_id === toolUseId) {
        return event.result;
      }
    }
  } catch (error) {
    captureException(error, {
      sessionId,
      feature: 'sessions',
      op: 'reconcile-gate-policy',
      toolUseId,
      toolName,
    });
  }
  return 'retry';
}
