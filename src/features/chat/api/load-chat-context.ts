'use server';

import { headers } from 'next/headers';
import { uploadConfig } from '@/features/files/server';
import { getWorkspaceSession } from '@/features/session-runtime';
import { loadSessionStatus } from '@/features/sessions';
import { resolveCaller } from '@/lib/caller';
import { withRequestContext } from '@/lib/request-context';
import { loadThreadMembers } from './thread-members';

/** Enrich an in-place Home opening without replacing its client tree. */
export async function loadChatContext(sessionId: string) {
  return withRequestContext({ route: 'chat-context' }, async () => {
    const { workspaceId, organizationId, userId } = await resolveCaller(await headers());
    const session = await getWorkspaceSession({ sessionId, workspaceId, viewerId: userId });
    const members =
      session?.visibility === 'workspace' ? await loadThreadMembers(organizationId) : undefined;
    const initialStatus = await loadSessionStatus({ sessionId, workspaceId, viewerId: userId });
    return { session, members, initialStatus, workspaceId, uploadConfig: await uploadConfig(null) };
  });
}
