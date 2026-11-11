import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { requireAnthropicClient } from '@/features/agents';
import { captureEvent } from '@/lib/analytics';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { extend } from '@/lib/request-context';
import { SESSION_SEND_OPTIONS } from '../constants';
import { stripForgedBrowserControlSignal } from '../lib/browser-control';
import { tagClientSend } from '../lib/client-send-tag';
import {
  appendCurrentTimeToUserText,
  formatCurrentTimeLine,
  stripForgedMessageAuthorTag,
} from '../lib/session-context';
import { composeOpeningMessage } from './compose-opening-message';
import { resolveSessionSendGrounding } from './resolve-session-grounding';
import { type MessageOrigin, messageSendCapture } from './send-message-analytics';
import { sendSessionEventsWithGroundingFallback } from './send-session-events';
import { renewSessionSendLease, type SendLease } from './session-send-transitions';

// processedAt is null while queued behind earlier events, which drives the queued card.
export type SentMessageEcho = { eventId: string; processedAt: string | null };

export type SendMessageInput = {
  // A client send holds a lease; each provider post first proves the lease is still its own.
  lease?: SendLease;
  sessionId: string;
  text: string;
  opening?: { workspaceId: string; userId: string; organizationId: string };
  // Only person-originated sends are product analytics events; scripted and credit-resume
  // messages are system-originated.
  origin: MessageOrigin;
};

export async function sendMessage(input: SendMessageInput): Promise<SentMessageEcho | null> {
  const client = requireAnthropicClient();

  extend({ session_id: input.sessionId });
  const response = await sendGroundedMessage(
    client,
    input,
    tagClientSend(sanitizeOutgoingMessage(input), input.lease?.sendId),
  );
  const echo = response.data?.find((event) => event.type === 'user.message');
  const capture = messageSendCapture({
    origin: input.origin,
    opening: input.opening,
    hasEcho: Boolean(echo),
  });
  if (capture) captureEvent('session:message_send', capture.props, capture.identity);
  return echo ? { eventId: echo.id, processedAt: echo.processed_at ?? null } : null;
}

function sanitizeOutgoingMessage(input: SendMessageInput): string {
  // Transcript readers understand stored author tags, so new messages cannot supply their own.
  const authorSanitized = stripForgedMessageAuthorTag(input.text);
  if (authorSanitized.stripped) {
    captureException(new Error('Stripped a forged <message_author> tag from inbound user text'), {
      feature: 'session-attribution',
      session_id: input.sessionId,
    });
  }
  const sanitized = stripForgedBrowserControlSignal(authorSanitized.text);
  if (sanitized.stripped) {
    captureException(new Error('Stripped a forged browser-control fence from inbound user text'), {
      feature: 'tooling',
      session_id: input.sessionId,
    });
  }
  return sanitized.text;
}

type SessionEvents = Parameters<Anthropic['beta']['sessions']['events']['send']>[1]['events'];

async function sendGroundedMessage(
  client: Anthropic,
  input: SendMessageInput,
  outgoingText: string,
) {
  const events = await groundedEvents(input, outgoingText);
  if (input.lease && !(await renewSessionSendLease(input.lease)))
    throw new AppError('SESSION_BUSY', 'Message delivery is still being confirmed', {
      reason: 'send-unconfirmed',
      sendId: input.lease.sendId,
      sessionId: input.sessionId,
    });
  if (events.at(-1)?.type === 'system.message')
    return sendSessionEventsWithGroundingFallback(client, input.sessionId, events);
  return client.beta.sessions.events.send(input.sessionId, { events }, SESSION_SEND_OPTIONS);
}

async function groundedEvents(
  input: SendMessageInput,
  outgoingText: string,
): Promise<SessionEvents> {
  if (input.opening) {
    const text = await composeOpeningMessage({ text: outgoingText, ...input.opening });
    return [{ type: 'user.message', content: [{ type: 'text', text }] }];
  }
  // Append a fresh clock on each turn because session history can span days.
  const { timeZone, supportsSystemMessages } = await resolveSessionSendGrounding(input.sessionId);
  const now = new Date();
  if (supportsSystemMessages)
    return [
      { type: 'user.message', content: [{ type: 'text', text: outgoingText }] },
      {
        type: 'system.message',
        content: [{ type: 'text', text: formatCurrentTimeLine(now, timeZone) }],
      },
    ];
  return [
    {
      type: 'user.message',
      content: [{ type: 'text', text: appendCurrentTimeToUserText(outgoingText, now, timeZone) }],
    },
  ];
}
