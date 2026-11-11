import 'server-only';
import { cache } from 'react';
import { fileContentUrl } from '@/lib/file-content-url';
import { resolveLiveShare } from '../lib/resolve-live-share';
import type { ResolvedShare } from '../types';
import { loadShare, shareFileScope, shareLinkState } from './live-share';
import { loadFilesInScope } from './load';

// Public resolution for /share/[token] — NO auth. Returns a discriminated result
// so the page renders exactly one state. Liveness is computed at request time.

export const resolveShare = cache(async (token: string): Promise<ResolvedShare> => {
  const row = await loadShare(token);

  if (!row) return { status: 'not_found' };

  const state = shareLinkState(row, new Date());
  if (state !== 'live') return { status: state };

  const files = await loadFilesInScope(shareFileScope(row));
  return resolveLiveShare(
    row,
    files.map((file) => ({ ...file, url: fileContentUrl(file.id, token) })),
  );
});
