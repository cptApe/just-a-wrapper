'use client';

import { billingQueryKeys } from '@/features/billing/api/keys';
import { captureException } from '@/lib/observability-client';
import type { ComposerCreditsState } from '../types';
import { loadComposerCredits } from './composer-credits';

export type ServerCredits = Extract<ComposerCreditsState, { kind: 'ready' | 'off' }>;

/** The composer's balance read. The server render seeds it; a failed read keeps the last balance. */
export function composerCreditsQuery(
  organizationId: string,
  initialCredits: ServerCredits | undefined,
  enabled: boolean,
) {
  return {
    queryKey: billingQueryKeys.composerCredits(organizationId),
    queryFn: async (): Promise<ServerCredits> => {
      try {
        return await loadComposerCredits();
      } catch (error) {
        // The browser rejects with TypeError when it cannot send a request. The last balance
        // stays on screen and the next window focus reads again.
        if (!(error instanceof TypeError)) captureException(error, { op: 'load-composer-credits' });
        throw error;
      }
    },
    initialData: initialCredits,
    enabled,
    retry: false,
  };
}
