import type { z } from 'zod';
import type { workspaceEventSchema } from '@/lib/workspace-event';
export type WorkspaceEvent = z.infer<typeof workspaceEventSchema> | { type: 'resync' };

export type SessionScopedEvent = Extract<
  WorkspaceEvent,
  { type: 'session_status' | 'session_title' | 'session_visibility' }
>;

// Private titles/statuses belong only to their creator. Visibility changes reach everyone
// because members must remove unshared rows; that event contains no task content.
export function audienceForSessionEvent(
  event: SessionScopedEvent,
  scope: {
    organizationId: string;
    session: { visibility: 'private' | 'workspace'; createdByUserId: string };
  },
): string | null {
  if (event.type === 'session_visibility' || scope.session.visibility === 'workspace') {
    return null;
  }
  return scope.session.createdByUserId;
}
// Server epoch milliseconds let clients measure event delivery latency.
export type PublishedWorkspaceEvent<E extends WorkspaceEvent = WorkspaceEvent> = E & {
  publishedAt: number;
};

// Generated titles may arrive after a user rename; replace only the matching previous title.
export function shouldApplySessionTitle(
  currentTitle: string | null | undefined,
  event: Extract<WorkspaceEvent, { type: 'session_title' }>,
): boolean {
  return (
    event.previousTitle === undefined ||
    currentTitle == null ||
    currentTitle === event.previousTitle ||
    currentTitle === event.title
  );
}
