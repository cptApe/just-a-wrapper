import 'server-only';
import { type SQL, sql } from 'drizzle-orm';
import { session as sessionTable } from '@/db/schema';

// One read predicate permits creator-owned or workspace-shared sessions.
// Other private sessions remain invisible across every read surface.
// Conversation and identity mutations use their separate write guards.
export function sessionVisibleToViewer(viewerId: string): SQL {
  return sql`(${sessionTable.createdByUserId} = ${viewerId} or ${sessionTable.visibility} = 'workspace')`;
}
