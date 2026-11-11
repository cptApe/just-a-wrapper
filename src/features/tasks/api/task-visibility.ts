import 'server-only';
import { type SQL, sql } from 'drizzle-orm';
import { task } from '@/db/schema';

/** Who may read a task: its creator and, once shared, the workspace. */
export function taskVisibleToViewer(userId: string): SQL {
  return sql`(${task.createdByUserId} = ${userId} or ${task.visibility} = 'workspace')`;
}

/** Who may change, run or delete a task: only its creator, even when shared. */
export function taskWritableBy(userId: string): SQL {
  return sql`${task.createdByUserId} = ${userId}`;
}
