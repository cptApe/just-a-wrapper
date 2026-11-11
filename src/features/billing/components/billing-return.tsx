'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { fetchJson } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { parseBillingResponse, stripeReconciliationSchema } from '../lib/billing-response';
import {
  type BillingReturnOutcome,
  type BillingReturnSource,
  billingReturnMessage,
  billingReturnTone,
} from '../lib/billing-return-outcome';
import { finishTopupAttempt } from '../lib/topup-attempt';

const returnParams = z.object({
  checkout: z.string().nullable(),
  topup: z.string().nullable(),
  portal: z.string().nullable(),
  session_id: z.string().nullable(),
});

// A toast that offers Try again stays long enough to read and reach the button.
const RETRY_TOAST_MS = 15_000;

type BillingReturnContext = {
  source: BillingReturnSource;
  checkoutSessionId: string | null;
  refreshPage: () => void;
};

function showOutcome(
  outcome: BillingReturnOutcome,
  context: BillingReturnContext,
  toastId?: string | number,
) {
  const retry = outcome === 'pending' || outcome === 'failed';
  toast[billingReturnTone(outcome)](billingReturnMessage(outcome, context.source), {
    ...(toastId === undefined ? {} : { id: toastId }),
    ...(retry
      ? {
          duration: RETRY_TOAST_MS,
          action: { label: 'Try again', onClick: () => void reconcile(context) },
        }
      : {}),
  });
}

async function reconcile(context: BillingReturnContext) {
  const toastId = toast.loading('Refreshing billing…');
  try {
    const result = parseBillingResponse(
      stripeReconciliationSchema,
      await fetchJson('/api/billing/reconcile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checkoutSessionId: context.checkoutSessionId }),
      }),
    );
    if (result.purchase) finishTopupAttempt(result.purchase.workspaceId, result.purchase);
    showOutcome(result.status, context, toastId);
    context.refreshPage();
  } catch (error) {
    captureException(error, { feature: 'billing', op: 'billing-return' });
    showOutcome('failed', context, toastId);
  }
}

export function BillingReturn() {
  const router = useRouter();
  useEffect(() => {
    const url = new URL(window.location.href);
    const params = returnParams.parse(
      Object.fromEntries(
        ['checkout', 'topup', 'portal', 'session_id'].map((key) => [
          key,
          url.searchParams.get(key),
        ]),
      ),
    );
    if (!params.checkout && !params.topup && !params.portal) return;
    for (const key of ['checkout', 'topup', 'portal', 'session_id']) url.searchParams.delete(key);
    // Consume the return before posting so reloads and repeated mounts cannot submit it again.
    // The hash stays: it is what keeps an open overlay open on this page.
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
    if (
      !['success', 'cancelled'].includes(params.checkout ?? '') &&
      !['success', 'cancelled'].includes(params.topup ?? '') &&
      params.portal !== 'returned' &&
      params.portal !== 'unavailable'
    )
      return;
    const context: BillingReturnContext = {
      source: params.topup ? 'topup' : params.checkout ? 'checkout' : 'portal',
      checkoutSessionId: params.session_id,
      refreshPage: () => router.refresh(),
    };
    // The root Toaster subscribes in its own effect, after this page's effects,
    // and misses anything published sooner. This is not cancelled on cleanup:
    // strict mode's second run finds the URL consumed and cannot schedule it again.
    queueMicrotask(() => {
      if (params.topup === 'cancelled' || params.checkout === 'cancelled') {
        showOutcome('cancelled', context);
      } else if (params.portal === 'unavailable') {
        showOutcome('unavailable', context);
      } else {
        void reconcile(context);
      }
    });
  }, [router]);
  return null;
}
