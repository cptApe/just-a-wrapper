import { stripAttachedFiles } from '@/features/sessions/lib/strip-attached-files';
import type { QueuedCardItem } from '../components/composer-queue';
import type { PendingSend } from '../components/pending-bubble';
import type { ChatItem } from './chat-state';

export type LocalSend = Omit<PendingSend, 'status' | 'errorMessage'> & {
  midRun?: boolean;
  opening?: boolean;
  statusAtSend?: number;
} & (
    | {
        status: 'sending' | 'unconfirmed';
        errorMessage?: never;
        serverEventId?: never;
        serverProcessedAt?: never;
      }
    | { status: 'error'; errorMessage?: string; serverEventId?: never; serverProcessedAt?: never }
    | {
        status: 'delivered';
        errorMessage?: never;
        serverEventId?: string;
        serverProcessedAt?: string;
      }
  );

// A queued-stack card from a message's raw text: the attachment markup is
// stripped (same helper as the thread's user bubbles) so the preview reads as
// what the user typed, and the stripped entries drive the file-count label.
export function toQueueCard(id: string, raw: string, status: 'queued' | 'error'): QueuedCardItem {
  const { text, entries } = stripAttachedFiles(raw);
  return { id, text, fileCount: entries.length, status };
}

// Stable local or server IDs reconcile sends. Older identical text is not delivery evidence.
// Presentation stays on the message after the pending entry is removed.
export function reconcilePending(
  pending: LocalSend[],
  items: ChatItem[],
): { visible: LocalSend[]; presentation: ReadonlyMap<string, 'thread' | 'stack'> } {
  const presentation = new Map<string, 'thread' | 'stack'>();
  for (const item of items) {
    if (item.type === 'message' && item.presentation) presentation.set(item.id, item.presentation);
  }
  if (pending.length === 0) return { visible: pending, presentation };
  const presentFor = (p: LocalSend): 'thread' | 'stack' =>
    p.midRun && !p.serverProcessedAt ? 'stack' : 'thread';

  const userItemIds = new Set<string>();
  const localEchoIds = new Map<string, string>();
  for (const item of items) {
    if (item.type === 'message' && item.role === 'user') {
      userItemIds.add(item.id);
      if (item.localId) localEchoIds.set(item.localId, item.id);
    }
  }
  const idMatched = new Set<string>();
  for (const p of pending) {
    const echoId = localEchoIds.get(p.localId) ?? p.serverEventId;
    if (!echoId || !userItemIds.has(echoId)) continue;
    idMatched.add(p.localId);
    presentation.set(echoId, presentFor(p));
  }

  const visible = pending.filter((send) => !idMatched.has(send.localId));
  return { visible, presentation };
}
