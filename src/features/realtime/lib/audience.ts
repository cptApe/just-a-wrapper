import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { realtimeEvent } from '@/db/schema/realtime-event';
export function eventAudienceQuery(organizationId: string, userId: string, after: bigint) {
  return and(
    eq(realtimeEvent.organizationId, organizationId),
    gt(realtimeEvent.id, after),
    or(isNull(realtimeEvent.audienceUserId), eq(realtimeEvent.audienceUserId, userId)),
  );
}
