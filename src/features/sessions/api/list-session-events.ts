import 'server-only';
import { requireAnthropicClient } from '@/features/agents';
import { extend } from '@/lib/request-context';
import { translateEvent } from '../lib/relay-translator';
import type { ChatEvent } from '../types';

// Load one complete session transcript. The Managed Sessions SDK iterator
// exhausts upstream pages here on the server; callers receive one chronological
// list with no cursor, cap, or page-boundary state.
export async function listSessionEvents(sessionId: string): Promise<ChatEvent[]> {
  const client = requireAnthropicClient();
  extend({ session_id: sessionId });

  const events: ChatEvent[] = [];
  for await (const event of client.beta.sessions.events.list(sessionId, null, {
    timeout: 30_000,
  })) {
    const chat = translateEvent(event);
    if (chat) events.push(chat);
  }
  return events;
}
