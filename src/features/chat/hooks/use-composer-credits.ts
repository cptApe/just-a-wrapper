'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { billingQueryKeys } from '@/features/billing/api/keys';
import { composerCreditsQuery, type ServerCredits } from '../api/composer-credits-query';
import { CREDITS_EXHAUSTED_BANNER_ID, dismissComposerBanner } from '../lib/composer-banner-store';
import type { ComposerCreditsState } from '../types';

export function useComposerCredits(
  readOnly: boolean,
  paused: boolean,
  initialCredits: ServerCredits | undefined,
) {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId() ?? 'unscoped';
  const query = useQuery(composerCreditsQuery(organizationId, initialCredits, !readOnly));

  // Every window focus reads again. A purchase refreshes the server render without one, so a
  // changed server balance or a pause reads again too; a newer read cancels an older one.
  const serverBalance = initialCredits?.kind === 'ready' ? initialCredits.creditBalance : null;
  const serverHasPlan = initialCredits?.kind === 'ready' ? initialCredits.hasPlan : null;
  useEffect(() => {
    if (readOnly) return;
    const queryKey = billingQueryKeys.composerCredits(organizationId);
    const refresh = () => void queryClient.invalidateQueries({ queryKey, exact: true });
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [readOnly, paused, serverBalance, serverHasPlan, queryClient, organizationId]);

  // Only a read clears the banner: the server render can be older than the failed send.
  const credits = query.data;
  const fetched = query.isFetchedAfterMount;
  useEffect(() => {
    if (!fetched || credits === undefined) return;
    if (credits.kind === 'off' || credits.creditBalance > 0) {
      dismissComposerBanner(CREDITS_EXHAUSTED_BANNER_ID);
    }
  }, [fetched, credits]);

  const state: ComposerCreditsState =
    credits ?? (query.isError && !query.isFetching ? { kind: 'error' } : { kind: 'loading' });
  return { state, retry: () => void query.refetch() };
}
