'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '@/db';
import { file } from '@/db/schema';
import { runAction } from '@/lib/action-state';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { FILES_ACTION } from '../constants';
import { fileIdInput, nameInput, parseActionInput } from '../lib/action-input';
import { isValidSegment } from '../lib/paths';
import { fileVisibleTo } from '../lib/team-folder';
import type { ActionResult } from '../types';

// Rename only display metadata. The Blob storage key is immutable;
// downloads use the display filename.

export async function renameFile(
  fileId: string,
  name: string,
): Promise<ActionResult<{ filename: string }>> {
  return runAction({ ...FILES_ACTION, route: 'files/rename', op: 'rename' }, async () => {
    const id = parseActionInput(fileIdInput, fileId, 'file not found');
    const newName = parseActionInput(nameInput, name, 'invalid file name');
    const { workspaceId, userId } = await resolveCaller(await headers());
    const filename = newName.trim();
    if (!isValidSegment(filename)) {
      throw new AppError('TOOL_INPUT_INVALID', 'invalid file name', { newName });
    }

    const updated = await db
      .update(file)
      .set({ filename })
      .where(
        and(
          eq(file.id, id),
          eq(file.workspaceId, workspaceId),
          isNull(file.deletedAt),
          fileVisibleTo(userId),
        ),
      )
      .returning({ id: file.id });
    if (updated.length === 0) {
      throw new AppError('TOOL_INPUT_INVALID', 'file not found', { id });
    }
    return { filename };
  });
}
