'use client';

import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { appendCreateHandoff } from '@/features/sessions/lib/create-handoff';
import { stripForgedMessageAuthorTag } from '@/features/sessions/lib/session-context';
import { AppError } from '@/lib/errors';
import { fetchVoid } from '@/lib/fetch-json';
import type { ComposerSubmission } from '../lib/composer-submission';
import { Composer } from './composer';

// Use the real task composer during loading with the URL session id as draft key.
// Sends append to the shared handoff and reconcile when ChatView receives their echoes.
// Keep uploads disabled until configuration arrives without moving the control.
export function TaskLoadingComposer() {
  const params = useParams<{ id?: string }>();
  const sessionId = params.id ?? null;

  async function onSend({ text }: ComposerSubmission) {
    if (!sessionId) throw new AppError('UNEXPECTED', 'send during load: no task id in the URL');
    const sendId = crypto.randomUUID();
    try {
      await fetchVoid(`/api/sessions/${sessionId}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, sendId }),
      });
      appendCreateHandoff(sessionId, {
        localId: sendId,
        text: stripForgedMessageAuthorTag(text).text,
        midRun: true,
        at: new Date().toISOString(),
      });
    } catch (error) {
      toast.error('Couldn’t send the message. Try again.');
      // Rethrow so the composer restores the cleared text.
      throw error;
    }
  }

  return (
    <Composer
      // Without an id in the URL there is no task to keep a draft for; this one stays in memory.
      draftKey={sessionId ?? '#loading'}
      onSend={onSend}
      attach={null}
      placeholder="Message the agent…"
    />
  );
}
