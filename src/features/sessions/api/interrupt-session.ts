import 'server-only';
import { requireAnthropicClient } from '@/features/agents';
import { extend } from '@/lib/request-context';
import type { SessionWriteGrant } from './session-access';

// user.interrupt without session_thread_id pauses every non-archived thread, matching Stop generating.
export async function interruptSession(grant: SessionWriteGrant): Promise<void> {
  const client = requireAnthropicClient();

  extend({ session_id: grant.anthropicSessionId });

  await client.beta.sessions.events.send(grant.anthropicSessionId, {
    events: [{ type: 'user.interrupt' }],
  });
}
