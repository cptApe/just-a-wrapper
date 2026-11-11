'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
import { useCreateSession } from '@/features/sessions/api/use-create-session';
// Avoid the chat barrel so opening search does not load the whole chat surface.
import { setCreateHandoff } from '@/features/sessions/lib/create-handoff';
import { BillingError } from '@/lib/errors';
import { isExpectedUserStateError } from '@/lib/expected-state-error';
import { captureException } from '@/lib/observability-client';
import { reloadWorkspaceChanged } from '@/lib/reload-workspace-changed';
import { buildConsultationMessage } from '../lib/consultation';
import { normalizeQuery } from '../lib/match';

// "Ask agent" starts a task through the same create mutation as Home. Closing search drops the
// attempt, so a task that finishes starting after that does not pull the person away.
export function useSearchConsultation(query: string, close: () => void) {
  const router = useRouter();
  const organizationId = useOrganizationId();
  const createSession = useCreateSession();
  const { reset } = createSession;
  const attempt = useRef<symbol | null>(null);

  async function askAgent() {
    const q = normalizeQuery(query);
    if (q === '' || attempt.current !== null || organizationId === null) return;
    const token = Symbol();
    attempt.current = token;
    const message = buildConsultationMessage(q);
    try {
      const { sessionId } = await createSession.mutateAsync({ message, tier: 'default' });
      if (attempt.current !== token) return;
      setCreateHandoff(sessionId, {
        localId: crypto.randomUUID(),
        text: message,
        at: new Date().toISOString(),
      });
      close();
      router.push(`/app/task/${sessionId}`);
    } catch (error) {
      if (attempt.current !== token) return;
      if (reloadWorkspaceChanged({ error })) return;
      if (!isExpectedUserStateError(error)) {
        captureException(error, { op: 'search-ask-agent', feature: 'search' });
      }
      toast.error(
        error instanceof BillingError ? error.message : 'Couldn’t start the task. Try again.',
      );
    } finally {
      if (attempt.current === token) attempt.current = null;
    }
  }

  const resetAsk = useCallback(() => {
    attempt.current = null;
    reset();
  }, [reset]);

  return { ask: createSession.isPending ? 'creating' : 'idle', askAgent, resetAsk } as const;
}
