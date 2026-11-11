import type { BetaManagedAgentsStreamSessionEvents } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { ChatEvent } from '../types';
import { parseBrowserControlSignal } from './browser-control';
import { readClientSendTag } from './client-send-tag';
import { extractFileRefs, textFromContent } from './event-content';
import { parseMessageAuthorTag, stripSessionContextTags } from './session-context';

export const TASK_RETRY_MESSAGE =
  'Please retry the interrupted task and continue where you left off.';

// Include user turns in replay so the transcript remains complete. Unprocessed user events
// legitimately have no timestamp.
export function translateUserMessage(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'user.message' }>,
): ChatEvent {
  const { text: rawText, sendId } = readClientSendTag(textFromContent(event.content));
  const browserControl = parseBrowserControlSignal(rawText);
  if (browserControl) {
    return {
      id: event.id,
      kind: 'browser_control',
      rawType: event.type,
      ...browserControl,
      at: event.processed_at ?? undefined,
    };
  }
  // Persisted transcripts can start with an author tag; it becomes the bubble's author chip.
  const { author, text } = parseMessageAuthorTag(rawText);
  // The Retry button's turn drives the agent; the person never said it.
  if (stripSessionContextTags(text) === TASK_RETRY_MESSAGE) {
    return { id: event.id, kind: 'raw', rawType: event.type };
  }
  return {
    id: event.id,
    kind: 'message',
    rawType: event.type,
    role: 'user',
    sendId,
    // Strip injected context at this shared read boundary so live, replay and public transcripts match
    // the original optimistic message text.
    text: stripSessionContextTags(text),
    at: event.processed_at ?? undefined,
    ...(author ? { author } : {}),
  };
}

export function translateAgentMessage(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'agent.message' }>,
): ChatEvent {
  const fileRefs = extractFileRefs(event.content);
  return {
    id: event.id,
    kind: 'message',
    rawType: event.type,
    role: 'assistant',
    text: readClientSendTag(textFromContent(event.content)).text,
    at: event.processed_at,
    ...(fileRefs.length > 0 ? { fileRefs } : {}),
  };
}

export function translateAgentThinking(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'agent.thinking' }>,
): ChatEvent {
  return { id: event.id, kind: 'thinking', rawType: event.type, at: event.processed_at };
}
