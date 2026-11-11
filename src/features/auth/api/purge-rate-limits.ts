import 'server-only';
import { count, lt } from 'drizzle-orm';
import { db } from '@/db';
import { rateLimit } from '@/db/schema';

// One day exceeds every auth throttle window, including plugin rules.
export async function purgeRateLimits({ dryRun }: { dryRun: boolean }) {
  const expired = lt(rateLimit.lastRequest, Date.now() - 24 * 60 * 60 * 1000);
  if (dryRun) {
    const rows = await db.select({ count: count() }).from(rateLimit).where(expired);
    return rows.reduce((total, row) => total + row.count, 0);
  }
  const deleted = await db.delete(rateLimit).where(expired).returning({ id: rateLimit.id });
  return deleted.length;
}
