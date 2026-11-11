import 'server-only';

import { getAnthropicClient } from '@/features/agents';
import { captureException } from '@/lib/observability';
import type { MemoryNotesPage, MemoryScope, MemoryScopeAccess } from '../types';
import { listNotesPage } from './notes';
import { resolveMemoryContext } from './resolve';
import { scopeAccessFor } from './store-access';

// Seed Memory access and the first requested scope/view page server-side
// so cold links paint real state. Later refinements fetch through server actions.

export type MemorySurfaceInitial = {
  access: Record<MemoryScope, MemoryScopeAccess>;
  initial: { scope: MemoryScope; page: MemoryNotesPage } | null;
};

export async function loadMemorySurface(
  headers: Headers,
  scope: MemoryScope,
  options: {
    accessOnly: boolean;
  },
): Promise<MemorySurfaceInitial> {
  const ctx = await resolveMemoryContext(headers);
  const access: Record<MemoryScope, MemoryScopeAccess> = {
    you: scopeAccessFor('you', ctx),
    workspace: scopeAccessFor('workspace', ctx),
  };

  const storeId = scope === 'you' ? ctx.userStoreId : ctx.workspaceStoreId;
  const client = getAnthropicClient();
  // Avoid a provider round trip when Files is visible; missing stores have no initial page.
  if (options.accessOnly || !storeId || !client) {
    return { access, initial: null };
  }

  try {
    const page = await listNotesPage(client, storeId, { cursor: null, pathPrefix: '/', depth: 1 });
    return { access, initial: { scope, page } };
  } catch (error) {
    // The page must still render (the client shows the error state + retry).
    captureException(error, { feature: 'memory', op: 'surface-initial', scope });
    return { access, initial: null };
  }
}
