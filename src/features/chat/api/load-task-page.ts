import { headers } from 'next/headers';
import { getWorkspaceSession } from '@/features/session-runtime';
import { loadSessionStatus, resolveSessionUuidByAnthropicId } from '@/features/sessions';
import { resolveCaller } from '@/lib/caller';
import { withRequestContext } from '@/lib/request-context';
import { loadThreadMembers } from './thread-members';
import 'server-only';
import { loadPageUploadConfig } from './load-page-upload-config';

export async function loadTaskPage(sessionId: string) {
  return withRequestContext({ route: 'task-page' }, async () => {
    const { workspaceId, organizationId, userId } = await resolveCaller(await headers());
    // Upstream links resolve only within the caller's workspace.
    const redirectId = sessionId.startsWith('sesn_')
      ? await resolveSessionUuidByAnthropicId({ anthropicSessionId: sessionId, workspaceId })
      : null;
    if (redirectId) return { kind: 'redirect' as const, sessionId: redirectId };
    const [session, initialStatus, config] = await Promise.all([
      getWorkspaceSession({ sessionId, workspaceId, viewerId: userId }),
      loadSessionStatus({ sessionId, workspaceId, viewerId: userId }),
      loadPageUploadConfig(),
    ]);
    // Private threads never show author chips, so they do not need the directory.
    const members =
      session?.visibility === 'workspace' ? await loadThreadMembers(organizationId) : undefined;
    return {
      kind: 'task' as const,
      props: {
        session,
        members,
        initialStatus,
        uploadConfig: config,
        workspaceId,
        organizationId,
        userId,
      },
    };
  });
}
