import 'server-only';
import { db } from '@/db';
import { processedWebhookEvent } from '@/db/schema';

export async function claimTaskEvent(
  connection: Pick<typeof db, 'insert'>,
  input: { eventId: string; eventType: string; payload: Record<string, unknown> },
): Promise<boolean> {
  const claimed = await connection
    .insert(processedWebhookEvent)
    .values({
      provider: 'anthropic',
      ...input,
    })
    .onConflictDoNothing({
      target: [processedWebhookEvent.provider, processedWebhookEvent.eventId],
    })
    .returning({ eventId: processedWebhookEvent.eventId });
  return claimed.length > 0;
}
