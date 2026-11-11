'use server';

import { headers } from 'next/headers';
import { runAction } from '@/lib/action-state';
import { resolveCaller } from '@/lib/caller';
import { FILES_ACTION } from '../constants';
import { libraryFilesQueryInput, parseActionInput } from '../lib/action-input';
import type { ActionResult } from '../types';
import { type LibraryFilesPage, type LibraryFilesQuery, loadFilesPage } from './load';

// The Files tab's load-more path (infinite scroll). Same SQL projection as the
// page's first render — the query shape is the url params, so the visible set
// never diverges between SSR and subsequent pages.

export async function loadLibraryFilesPage(
  input: LibraryFilesQuery,
): Promise<ActionResult<LibraryFilesPage>> {
  return runAction({ ...FILES_ACTION, route: 'files/list', op: 'list' }, async () => {
    const query = parseActionInput(libraryFilesQueryInput, input, 'invalid file list query');
    const { workspaceId, userId } = await resolveCaller(await headers());
    return loadFilesPage(workspaceId, userId, query);
  });
}
