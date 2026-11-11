import 'server-only';
import { requireAnthropicClient } from '@/features/agents';

export async function taskRunHasCompleted(anthropicSessionId: string): Promise<boolean> {
  const client = requireAnthropicClient();
  const session = await client.beta.sessions.retrieve(anthropicSessionId, {}, { timeout: 30_000 });
  if (session.status === 'terminated') return true;
  if (session.status !== 'idle') return false;
  const page = await client.beta.sessions.events.list(
    anthropicSessionId,
    { order: 'desc', types: ['session.status_idle'], limit: 1 },
    { timeout: 30_000 },
  );
  for await (const event of page) {
    if (event.type === 'session.status_idle')
      return (
        event.stop_reason.type !== 'requires_action' && event.stop_reason.type !== 'budget_reached'
      );
  }
  // A missing stop event is not proof of completion. The sweep retries after indexing catches up.
  return false;
}
