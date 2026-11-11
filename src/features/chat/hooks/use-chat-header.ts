'use client';
import { useState } from 'react';
import { useWorkspaceChannel } from '@/features/realtime/hooks/use-workspace-channel';
import { shouldApplySessionTitle } from '@/features/realtime/lib/channel';
import type { WorkspaceSessionDetail } from '@/features/sessions';
import { useCachedSessionList } from '@/features/sessions/api/use-cached-session-list';
import { useSessionEdits } from '@/features/sessions/api/use-session-mutations';
import { useAsyncAction } from '@/hooks/use-async-action';
import { discardDraft } from '../lib/draft-store';

type HeaderFields = { title: string | null; pinned: boolean };

// The header reads title and pin from the sidebar's session row, which the shared
// session edits update optimistically and roll back. A task the loaded sidebar pages
// do not hold falls back to the session prop plus this header's own saved edits.
export function useChatHeader(
  sessionId: string,
  session: WorkspaceSessionDetail | null,
  organizationId: string,
  userId: string | null,
) {
  const sidebar = useCachedSessionList(organizationId);
  const row = sidebar?.pages.flatMap((page) => page.items).find((item) => item.id === sessionId);
  const [unlisted, setUnlisted] = useState<Partial<HeaderFields>>({});
  const fields: HeaderFields | null = row
    ? { title: row.title, pinned: Boolean(row.favoritedAt) }
    : session
      ? {
          title: unlisted.title !== undefined ? unlisted.title : session.title,
          pinned: unlisted.pinned ?? Boolean(session.favoritedAt),
        }
      : null;
  const title = fields?.title ?? '';
  const pinned = fields?.pinned ?? false;
  const edits = useSessionEdits(organizationId, discardDraft);
  const rename = useAsyncAction();
  const pin = useAsyncAction();
  // The sidebar list applies title events to rows it holds; only an unlisted task needs this.
  useWorkspaceChannel(organizationId || null, userId, (event) => {
    if (row || event.type !== 'session_title' || event.sessionId !== sessionId) return;
    if (shouldApplySessionTitle(title, event))
      setUnlisted((own) => ({ ...own, title: event.title }));
  });
  const saveTitle = (next: string) =>
    rename.run(async () => {
      const trimmed = next.trim();
      if (!trimmed || trimmed === title) return;
      const previous = unlisted;
      if (!row) setUnlisted((own) => ({ ...own, title: trimmed }));
      if (await edits.rename(sessionId, trimmed)) return;
      if (!row) setUnlisted(previous);
    });
  const togglePin = () =>
    pin.run(async () => {
      if (!fields) return;
      const next = !fields.pinned;
      const previous = unlisted;
      if (!row) setUnlisted((own) => ({ ...own, pinned: next }));
      const failure = next ? 'Couldn’t pin the task.' : 'Couldn’t unpin the task.';
      if (await edits.setFavorited(sessionId, next, failure)) return;
      if (!row) setUnlisted(previous);
    });
  const remove = () => edits.remove(sessionId);
  return { title, pinned, saveTitle, togglePin, remove, pinBusy: pin.pending || !fields };
}
