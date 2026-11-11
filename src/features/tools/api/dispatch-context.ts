import 'server-only';
import {
  authorizeSessionAccess,
  authorizeSessionWrite,
  type SessionWriteGrant,
} from '@/features/sessions/api/session-access';
import type { DispatchContext } from '@/features/tool-catalog/types';

// Readers may recover genuine pending agent events; decisions and tool runs stay the creator's.
export async function resolveDispatchContext(
  headers: Headers,
  sessionId: string,
): Promise<DispatchContext> {
  const grant = await authorizeSessionAccess({ sessionId, headers });
  return {
    anthropicSessionId: grant.anthropicSessionId,
    sessionRowId: grant.sessionRowId,
    workspaceId: grant.workspaceId,
    organizationId: grant.organizationId,
    userId: grant.userId,
    actorUserId: grant.createdByUserId,
  };
}

// Readers of a shared task can see it, but only its creator may touch the live browser.
export function authorizeBrowserControl(
  headers: Headers,
  sessionId: string,
): Promise<SessionWriteGrant> {
  return authorizeSessionWrite({ sessionId, headers });
}
