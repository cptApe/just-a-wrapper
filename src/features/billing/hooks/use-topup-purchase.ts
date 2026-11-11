'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { fetchJson } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { reloadWorkspaceChanged } from '@/lib/reload-workspace-changed';
import { billingQueryKeys } from '../api/keys';
import { parseBillingResponse, topupChargeSchema } from '../lib/billing-response';
import { readTopupAttempt } from '../lib/topup-attempt';

export type TopupFailure = { message: string; changeCard: boolean };

type Purchase = { credits: number; workspaceId: string };

const CARD_FAILURE_MESSAGE = {
  declined: 'Your card was declined. Nothing was charged.',
  authentication_required: 'Your bank needs to approve this charge. Nothing was charged.',
} as const;

const attemptStorageKey = ({ credits, workspaceId }: Purchase) =>
  `billing-topup:${workspaceId}:${credits}`;

// One attempt key per amount makes a double click or a retry charge once.
// A failed card discards its key because Stripe replays the same failure for a reused key.
export function useTopupPurchase({
  expectedOrganizationId,
  onClose,
}: {
  expectedOrganizationId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutationKey = billingQueryKeys.topup(expectedOrganizationId);
  const [failure, setFailure] = useState<TopupFailure | null>(null);
  // The page is going away (to Stripe, or a reload): the button stays busy until it does.
  const [leaving, setLeaving] = useState(false);

  // Back from Stripe restores this page from the browser cache with the button still busy.
  useEffect(() => {
    function restore(event: PageTransitionEvent) {
      if (event.persisted) setLeaving(false);
    }
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);

  function close(show: () => void) {
    show();
    router.refresh();
    onClose();
  }

  const charge = useMutation({
    mutationKey,
    mutationFn: async (purchase: Purchase) =>
      parseBillingResponse(
        topupChargeSchema,
        await fetchJson('/api/billing/topup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedOrganizationId,
            credits: purchase.credits,
            idempotencyKey: readTopupAttempt(attemptStorageKey(purchase)).key,
          }),
        }),
      ),
    onSuccess: (result, purchase) => {
      if (result.outcome === 'fallback') {
        setLeaving(true);
        window.location.assign(result.url);
        return;
      }
      if (result.outcome === 'processing') {
        close(() => toast('Payment processing. Your credits arrive soon.'));
        return;
      }
      localStorage.removeItem(attemptStorageKey(purchase));
      if (result.outcome === 'charged' || result.outcome === 'already_charged') {
        close(() => toast.success('Credits added'));
        return;
      }
      setFailure(
        result.outcome === 'card_failed'
          ? { message: CARD_FAILURE_MESSAGE[result.reason], changeCard: true }
          : { message: 'This payment expired. Try again.', changeCard: false },
      );
    },
    onError: (cause, { credits }) => {
      if (reloadWorkspaceChanged({ error: cause })) {
        setLeaving(true);
        return;
      }
      captureException(cause, { feature: 'billing', op: 'topup', credits });
      setFailure({
        message: 'Could not confirm the payment. Check your balance before trying again.',
        changeCard: false,
      });
    },
  });

  function pay(credits: number, workspaceId: string) {
    // Read from the cache, not from render state, so a second click in the same frame is ignored.
    if (leaving || queryClient.isMutating({ mutationKey, exact: true }) > 0) return;
    setFailure(null);
    charge.mutate({ credits, workspaceId });
  }

  return {
    pay,
    failure,
    clearFailure: () => setFailure(null),
    pending: charge.isPending || leaving,
  };
}
