'use client';

import { Button } from '@/components/ui/button';
import { ModalContent, ModalDescription, ModalFooter } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { formatMoney } from '@/lib/format/format-money';
import { formatCount } from '@/lib/format/format-number';
import { usePlanPreview } from '../hooks/use-plan-purchase';
import type { PlanChoice } from '../lib/plan-picker-packs';
import { PLANS } from '../pricing-config';

// Nothing is charged until the person has seen Stripe's exact amount; the server checks the
// same amount again before it charges.
export function PlanChargeStep({
  organizationId,
  choice,
  pending,
  failure,
  onPay,
}: {
  organizationId: string;
  choice: PlanChoice;
  pending: boolean;
  failure: string | null;
  onPay: (confirmation: { prorationDate: number; amountCents: number }) => void;
}) {
  const preview = usePlanPreview(organizationId, choice);
  const amount = preview.data ? formatMoney(preview.data.amountCents, preview.data.currency) : null;

  return (
    <>
      <ModalContent className="flex flex-col gap-3">
        <ModalDescription>
          {PLANS[choice.tier].name} with {formatCount(choice.credits)} credits a month starts now.
          Its credits for the rest of this period arrive once the payment clears.
        </ModalDescription>
        {/* One fixed-height line for every state, so the amount arriving moves nothing. */}
        <div className="flex min-h-6 items-center text-body">
          {preview.isPending ? <Skeleton className="h-4 w-32" /> : null}
          {amount ? <p className="tabular-nums">You pay {amount} now.</p> : null}
          {preview.isError ? (
            <p role="alert" className="text-destructive">
              Could not load the price. Go back and try again.
            </p>
          ) : null}
        </div>
        <p role="alert" className="min-h-5 text-meta text-destructive">
          {failure}
        </p>
      </ModalContent>
      <ModalFooter>
        {/* The minimum width holds the footer still while the label gains its amount. */}
        <Button
          type="button"
          className="min-w-36 tabular-nums"
          disabled={!preview.data || pending}
          onClick={() => {
            if (preview.data)
              onPay({
                prorationDate: preview.data.prorationDate,
                amountCents: preview.data.amountCents,
              });
          }}
        >
          {pending ? <Spinner aria-hidden /> : null}
          {pending ? 'Paying…' : amount === null ? 'Pay' : `Pay ${amount}`}
        </Button>
      </ModalFooter>
    </>
  );
}
