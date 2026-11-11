'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { fetchJson } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { reloadWorkspaceChanged } from '@/lib/reload-workspace-changed';
import { billingQueryKeys } from '../api/keys';
import {
  parseBillingResponse,
  planCancelSchema,
  planChangePreviewSchema,
  planChangeSchema,
  planCheckoutSchema,
  planOptionsSchema,
} from '../lib/billing-response';
import { type PlanChoice, planChangeFailure, planChangeMessage } from '../lib/plan-picker-packs';

const JSON_HEADERS = { 'content-type': 'application/json' };

function post(url: string, body: unknown) {
  return fetchJson(url, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
}

export function usePlanOptions(organizationId: string, open: boolean) {
  return useQuery({
    queryKey: billingQueryKeys.planOptions(organizationId),
    queryFn: async () =>
      parseBillingResponse(planOptionsSchema, await fetchJson('/api/billing/plan')),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Stripe's exact charge for a change that starts now; asked again each time it is shown. */
export function usePlanPreview(organizationId: string, choice: PlanChoice | null) {
  return useQuery({
    queryKey: billingQueryKeys.planPreview(organizationId, JSON.stringify(choice)),
    queryFn: async () =>
      parseBillingResponse(
        planChangePreviewSchema,
        await post('/api/billing/plan/preview', {
          ...choice,
          expectedOrganizationId: organizationId,
        }),
      ),
    enabled: choice !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

type PlanRequest =
  | { kind: 'checkout'; choice: PlanChoice }
  | {
      kind: 'change';
      choice: PlanChoice;
      confirmation?: { prorationDate: number; amountCents: number };
    };

// One purchase or change at a time; Checkout leaves the page, a change refreshes it and closes.
export function usePlanPurchase({
  organizationId,
  onDone,
}: {
  organizationId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutationKey = billingQueryKeys.plan(organizationId);
  const [failure, setFailure] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  // Back from Stripe restores this page from the browser cache with the button still busy.
  useEffect(() => {
    function restore(event: PageTransitionEvent) {
      if (event.persisted) setLeaving(false);
    }
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);

  const mutation = useMutation({
    mutationKey,
    mutationFn: async (request: PlanRequest) => {
      const body = { ...request.choice, expectedOrganizationId: organizationId };
      if (request.kind === 'checkout') {
        const { url } = parseBillingResponse(
          planCheckoutSchema,
          await post('/api/billing/plan/checkout', body),
        );
        return { kind: 'checkout' as const, url };
      }
      const result = parseBillingResponse(
        planChangeSchema,
        await post('/api/billing/plan/change', { ...body, confirmation: request.confirmation }),
      );
      return { kind: 'change' as const, effective: result.effective };
    },
    onSuccess: (result) => {
      if (result.kind === 'checkout') {
        setLeaving(true);
        window.location.assign(result.url);
        return;
      }
      toast.success(planChangeMessage(result.effective));
      void queryClient.invalidateQueries({ queryKey: billingQueryKeys.all(organizationId) });
      router.refresh();
      onDone();
    },
    onError: (cause, request) => {
      if (reloadWorkspaceChanged({ error: cause })) {
        setLeaving(true);
        return;
      }
      const refusal = planChangeFailure(cause);
      if (refusal.report)
        captureException(cause, {
          feature: 'billing',
          op: `plan-${request.kind}`,
          ...request.choice,
        });
      setFailure(
        request.kind === 'checkout' && refusal.report
          ? 'Could not open the payment page. Try again.'
          : refusal.message,
      );
    },
  });

  function run(request: PlanRequest) {
    if (leaving || queryClient.isMutating({ mutationKey, exact: true }) > 0) return;
    setFailure(null);
    mutation.mutate(request);
  }

  return {
    checkout: (choice: PlanChoice) => run({ kind: 'checkout', choice }),
    change: (choice: PlanChoice, confirmation?: { prorationDate: number; amountCents: number }) =>
      run({ kind: 'change', choice, confirmation }),
    failure,
    clearFailure: () => setFailure(null),
    pending: mutation.isPending || leaving,
    working: mutation.isPending ? mutation.variables.choice : null,
  };
}

/** Cancel at the period end, or take a pending cancellation back. */
export function usePlanCancel(organizationId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: billingQueryKeys.plan(organizationId),
    mutationFn: async (resume: boolean) =>
      parseBillingResponse(
        planCancelSchema,
        await post('/api/billing/plan/cancel', { expectedOrganizationId: organizationId, resume }),
      ),
    onSuccess: (_result, resume) => {
      toast.success(resume ? 'Your plan will renew.' : 'Your plan ends at the end of this period.');
      void queryClient.invalidateQueries({ queryKey: billingQueryKeys.all(organizationId) });
      router.refresh();
    },
    onError: (cause, resume) => {
      if (reloadWorkspaceChanged({ error: cause })) return;
      const refusal = planChangeFailure(cause);
      if (refusal.report)
        captureException(cause, { feature: 'billing', op: 'plan-cancel', resume });
      toast.error(refusal.report ? 'Could not update your plan. Try again.' : refusal.message);
    },
  });
}
