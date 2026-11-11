'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '@/db';
import { file } from '@/db/schema';
import { runAction } from '@/lib/action-state';
import { resolveCaller } from '@/lib/caller';
import { FILES_ACTION } from '../constants';
import { fileIdsInput, parseActionInput } from '../lib/action-input';
import { fileVisibleTo } from '../lib/team-folder';
import type { ActionResult } from '../types';
import { transitionFiles } from './trash-transitions';

// Stored bytes remain until the daily sweep enforces the trash retention window.

export async function deleteFiles(input: string[]): Promise<ActionResult<{ removed: number }>> {
  return runAction({ ...FILES_ACTION, route: 'files/delete', op: 'delete' }, async () => {
    const ids = parseActionInput(fileIdsInput, input, 'invalid file selection');
    const { workspaceId, userId } = await resolveCaller(await headers());

    const removed = await transitionFiles(
      db,
      and(eq(file.workspaceId, workspaceId), fileVisibleTo(userId), inArray(file.id, ids)),
      new Date(),
    );

    // 0 rows = the files were already gone (e.g. a concurrent delete) — the
    // desired end state holds, so this is a no-op success, not an error.
    return { removed: removed.length };
  });
}
