'use client';
import { useEffect } from 'react';
import type { ChatEvent } from '@/features/sessions';
import {
  clearCreateHandoff,
  peekCreateHandoff,
  subscribeCreateHandoff,
} from '@/features/sessions/lib/create-handoff';
import { stripForgedMessageAuthorTag } from '@/features/sessions/lib/session-context';
import type { ChatItem } from '../lib/chat-state';
import { cancelOptimisticSendEvent } from '../lib/chat-store';
import { pendingSendReducer } from '../lib/pending-send-machine';
import type { LocalSend } from '../lib/reconcile-pending';
import { useMachineStore } from './use-machine-store';

export function usePendingSends({
  sessionId,
  foldEvent,
  items,
  replaySettled,
  statusAt,
}: {
  sessionId: string;
  items: ChatItem[];
  replaySettled: boolean;
  statusAt: string | null;
  foldEvent: (event: ChatEvent) => void;
}) {
  const {
    state: pending,
    dispatch: dispatchPending,
    getSnapshot,
  } = useMachineStore((): LocalSend[] => {
    const handoff = peekCreateHandoff(sessionId);
    if (!handoff) return [];
    return [handoff, ...handoff.queued].map((entry) => ({
      localId: entry.localId,
      text: stripForgedMessageAuthorTag(entry.text).text,
      attachments: entry.attachments,
      status: 'delivered',
      midRun: entry.midRun,
      opening: !entry.midRun,
    }));
  }, pendingSendReducer);
  useEffect(() => {
    // Session creation has no send receipt; only its first user event can confirm the opening.
    const firstUser = items.find((item) => item.type === 'message' && item.role === 'user');
    const confirmedOpenings = pending
      .filter(
        (send) =>
          send.opening &&
          firstUser?.type === 'message' &&
          firstUser.localId !== firstUser.id &&
          firstUser.text.trim() === send.text.trim(),
      )
      .map((send) => send.localId);
    dispatchPending({
      type: 'reconcile',
      statusAt: statusAt ? Date.parse(statusAt) : undefined,
      echoedLocalIds: new Set([
        ...confirmedOpenings,
        ...items.flatMap((item) =>
          item.type === 'message' && item.localId && item.localId !== item.id ? [item.localId] : [],
        ),
      ]),
    });
  }, [items, statusAt, dispatchPending, pending]);
  useEffect(() => {
    if (!replaySettled) return;
    for (const entry of getSnapshot()) {
      if (entry.status === 'unconfirmed') foldEvent(cancelOptimisticSendEvent(entry.localId));
    }
    dispatchPending({ type: 'replay_settled' });
  }, [replaySettled, dispatchPending, foldEvent, getSnapshot]);
  useEffect(() => {
    const consume = () => {
      const handoff = peekCreateHandoff(sessionId);
      if (!handoff) return;
      clearCreateHandoff(sessionId);
      for (const entry of [handoff, ...handoff.queued]) {
        dispatchPending({
          type: 'add',
          send: {
            localId: entry.localId,
            text: stripForgedMessageAuthorTag(entry.text).text,
            attachments: entry.attachments,
            status: 'delivered',
            midRun: entry.midRun,
            opening: !entry.midRun,
          },
        });
      }
      // Delivered handoffs may arrive after replay, so do not add unconfirmed anchors.
    };
    consume();
    return subscribeCreateHandoff(sessionId, consume);
  }, [sessionId, dispatchPending]);

  return { pending, dispatchPending, getPending: getSnapshot };
}
