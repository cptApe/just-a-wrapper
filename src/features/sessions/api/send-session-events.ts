import { SESSION_SEND_OPTIONS } from '../constants';
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { APIError } from '@anthropic-ai/sdk';
import type { BetaManagedAgentsSendSessionEvents } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import { z } from 'zod';
import { captureException } from '@/lib/observability';

// Models can reject trailing system.message grounding. Retry that specific
// rejection once without grounding and capture the failure; rethrow other errors.
// The rejected multi-event send is atomic, so retrying cannot duplicate the user event.
type SendEvents = Parameters<Anthropic['beta']['sessions']['events']['send']>[1]['events'];

// Anthropic rejects system.message on unsupported primary models with
// model_does_not_support_mid_conversation_system; retry without that trailing context.
// https://platform.claude.com/docs/en/managed-agents/events-and-streaming#supported-models
const unsupportedSystemError = z.object({
  error: z.object({
    type: z.literal('model_does_not_support_mid_conversation_system'),
  }),
});

function isSystemMessageUnsupported(error: unknown): boolean {
  return (
    error instanceof APIError &&
    error.status === 400 &&
    unsupportedSystemError.safeParse(error.error).success
  );
}

export async function sendSessionEventsWithGroundingFallback(
  client: Anthropic,
  anthropicSessionId: string,
  events: SendEvents,
): Promise<BetaManagedAgentsSendSessionEvents> {
  try {
    return await client.beta.sessions.events.send(
      anthropicSessionId,
      { events },
      SESSION_SEND_OPTIONS,
    );
  } catch (error) {
    const last = events.at(-1);
    if (isSystemMessageUnsupported(error) && last?.type === 'system.message') {
      // Drop the grounding turn and resend the rest. The message still lands; the
      // session just loses grounding for this turn rather than failing outright.
      captureException(error, {
        feature: 'session-grounding',
        session_id: anthropicSessionId,
        note: 'system.message rejected by model; retried without the grounding turn',
      });
      return client.beta.sessions.events.send(
        anthropicSessionId,
        {
          events: events.slice(0, -1),
        },
        SESSION_SEND_OPTIONS,
      );
    }
    throw error;
  }
}
