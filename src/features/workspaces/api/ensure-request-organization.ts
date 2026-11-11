import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { getRequestSession } from '@/lib/request-session';
import { ensurePersonalWorkspace } from './ensure-personal-workspace';

// A route's layout and page render in parallel, so a page cannot assume the shell
// gate already created the workspace. Both await this one per-request resolution.
export const ensureRequestOrganization = cache(async (): Promise<string> => {
  return ensurePersonalWorkspace(await headers(), await getRequestSession());
});
