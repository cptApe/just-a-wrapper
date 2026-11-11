import 'server-only';
import { count, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { realtimeEvent } from '@/db/schema';
import { sweepDeadline } from '@/lib/sweep-deadline';
import { EVENT_RETENTION_MS } from '../constants';
export async function purgeExpiredRealtimeRows({ dryRun }: { dryRun: boolean }) {
  const events = lt(realtimeEvent.createdAt, new Date(Date.now() - EVENT_RETENTION_MS));
  if (dryRun) {
    const eventCounts = await db.select({ count: count() }).from(realtimeEvent).where(events);
    return { events: eventCounts.reduce((sum, row) => sum + row.count, 0) };
  }
  const deadline = sweepDeadline();
  const total = { events: 0 };
  while (Date.now() < deadline) {
    const deleted = await db
      .delete(realtimeEvent)
      .where(
        sql`${realtimeEvent.id} in (select ${realtimeEvent.id} from ${realtimeEvent} where ${events} limit 1000)`,
      )
      .returning({ id: realtimeEvent.id });
    total.events += deleted.length;
    if (deleted.length < 1000) break;
  }
  return total;
}
