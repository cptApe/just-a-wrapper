'use client';

import { useState } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { usePlansForSale } from '@/components/providers/deployment-capabilities-provider';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { Button } from '@/components/ui/button';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
// Type-only import: the registry imports this file, so a value import would be a module loop.
import type { OverlayComponentProps } from '@/features/overlays';
import { useOverlayCloseGuard } from '@/features/overlays/hooks/use-overlay-close-guard';
import { openOverlay } from '@/features/overlays/lib/overlay-history';
import { AppError } from '@/lib/errors';
import { formatShortDate } from '@/lib/format/format-date';
import { formatCount } from '@/lib/format/format-number';
import type { PlanOptions } from '../api/get-plan-options';
import { usePlanOptions, usePlanPurchase } from '../hooks/use-plan-purchase';
import { findPack, type PlanChoice, planChangeTiming } from '../lib/plan-picker-packs';
import {
  type BillingInterval,
  PLAN_TIERS,
  PLANS,
  type PlanTier,
  YEARLY_CHARGED_MONTHS,
  YEARLY_DELIVERED_MONTHS,
} from '../pricing-config';
import { BillingReturn } from './billing-return';
import { PlanCard } from './plan-card';
import { PlanChargeStep } from './plan-charge-step';

const FREE_MONTHS = YEARLY_DELIVERED_MONTHS - YEARLY_CHARGED_MONTHS;

export function PlansOverlay({ open, onClose }: OverlayComponentProps) {
  const organizationId = useOrganizationId();
  const plansForSale = usePlansForSale();
  if (organizationId === null || !plansForSale) return null;
  return <PlanDialog open={open} onClose={onClose} organizationId={organizationId} />;
}

function PlanDialog({
  open,
  onClose,
  organizationId,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
}) {
  const options = usePlanOptions(organizationId, open);
  // A change that charges now asks to confirm Stripe's exact amount in a second step.
  const [charging, setCharging] = useState<PlanChoice | null>(null);
  const purchase = usePlanPurchase({
    organizationId,
    onDone: () => {
      releaseCloseGuard();
      onClose();
    },
  });
  const releaseCloseGuard = useOverlayCloseGuard(purchase.pending);
  const current = options.data?.current ?? null;

  return (
    <>
      <BillingReturn />
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (next || purchase.pending) return;
          purchase.clearFailure();
          onClose();
        }}
        presentation="dialog"
        size={charging ? 'sm' : 'lg'}
      >
        <ModalHeader
          onBack={
            charging && !purchase.pending
              ? () => {
                  purchase.clearFailure();
                  setCharging(null);
                }
              : undefined
          }
        >
          <ModalTitle>
            {charging ? 'Confirm your new plan' : current ? 'Change your plan' : 'Choose a plan'}
          </ModalTitle>
        </ModalHeader>
        {charging ? (
          <PlanChargeStep
            organizationId={organizationId}
            choice={charging}
            pending={purchase.pending}
            failure={purchase.failure}
            onPay={(confirmation) => purchase.change(charging, confirmation)}
          />
        ) : (
          <>
            <ModalContent>
              <PlanDialogBody
                options={options}
                purchase={purchase}
                onCharge={(choice) => {
                  purchase.clearFailure();
                  setCharging(choice);
                }}
              />
            </ModalContent>
            <ModalFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={purchase.pending}
                onClick={() => openOverlay('topup')}
              >
                Buy credits once
              </Button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </>
  );
}

function PlanDialogBody({
  options,
  purchase,
  onCharge,
}: {
  options: ReturnType<typeof usePlanOptions>;
  purchase: ReturnType<typeof usePlanPurchase>;
  onCharge: (choice: PlanChoice) => void;
}) {
  if (options.error !== null && !options.isFetching) {
    const serverCode = options.error instanceof AppError ? options.error.context.serverCode : null;
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-body text-muted-foreground" role="alert">
          {serverCode === 'FORBIDDEN'
            ? 'Only workspace owners and admins can change the plan.'
            : 'Plans cannot be loaded right now.'}
        </p>
        {serverCode === 'FORBIDDEN' ? null : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void options.refetch()}
          >
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (options.data === undefined) return <PlanDialogSkeleton />;
  if (options.data.packs.length === 0) {
    return (
      <p className="py-12 text-center text-body text-muted-foreground">Plans are not set up yet.</p>
    );
  }
  return <PlanPicker options={options.data} purchase={purchase} onCharge={onCharge} />;
}

function PlanPicker({
  options,
  purchase,
  onCharge,
}: {
  options: PlanOptions;
  purchase: ReturnType<typeof usePlanPurchase>;
  onCharge: (choice: PlanChoice) => void;
}) {
  const { current, packs } = options;
  const [interval, setInterval] = useState<BillingInterval>(current?.interval ?? 'month');
  const [creditsByTier, setCreditsByTier] = useState<Record<PlanTier, number>>(() => ({
    pro: current?.tier === 'pro' && current.credits ? current.credits : PLANS.pro.minCredits,
    max: current?.tier === 'max' && current.credits ? current.credits : PLANS.max.minCredits,
  }));

  function choose(choice: PlanChoice) {
    if (current === null) return purchase.checkout(choice);
    const pack = findPack(packs, choice);
    if (!pack) return;
    const timing = planChangeTiming(current, {
      tier: pack.tier,
      interval: pack.interval,
      amountCents: pack.unitAmount,
    });
    if (timing === 'now') onCharge(choice);
    else purchase.change(choice);
  }

  return (
    <div className="flex flex-col gap-6">
      <PlanStatus options={options} />
      <div className="flex justify-center">
        <Segmented
          label="How often you pay"
          value={interval}
          disabled={purchase.pending}
          options={[
            { value: 'month', label: 'Monthly' },
            { value: 'year', label: `Yearly, ${formatCount(FREE_MONTHS)} months free` },
          ]}
          onChange={(next) => {
            if (next === null) return;
            purchase.clearFailure();
            setInterval(next);
          }}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {PLAN_TIERS.map((tier) => (
          <PlanCard
            key={tier}
            tier={tier}
            packs={packs}
            interval={interval}
            credits={creditsByTier[tier]}
            current={current}
            scheduled={options.scheduled}
            busy={purchase.pending}
            working={purchase.working?.tier === tier}
            onCreditsChange={(credits) => {
              purchase.clearFailure();
              setCreditsByTier((byTier) => ({ ...byTier, [tier]: credits }));
            }}
            onChoose={choose}
          />
        ))}
      </div>
      {/* One reserved line, so a refusal moves nothing. */}
      <p role="alert" className="min-h-5 text-center text-meta text-destructive">
        {purchase.failure}
      </p>
    </div>
  );
}

function PlanStatus({ options }: { options: PlanOptions }) {
  const { timeZone } = useDisplayFormat();
  const sentence = options.pastDue
    ? 'Your last payment failed. Update your card in Billing to keep your plan.'
    : options.cancelsAt
      ? `Your plan ends on ${formatShortDate(options.cancelsAt, timeZone)}. Choose a plan to keep it.`
      : options.scheduled
        ? `${PLANS[options.scheduled.tier].name} with ${formatCount(options.scheduled.credits)} credits a month starts on ${formatShortDate(options.scheduled.startsAt, timeZone)}.`
        : options.current
          ? 'A bigger plan starts now and you pay the difference. A smaller one starts at your next renewal.'
          : 'Every plan charges the same for a credit. Plans differ in what they let you run.';
  return <ModalDescription className="text-center">{sentence}</ModalDescription>;
}

function PlanDialogSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <Skeleton className="mx-auto h-5 w-80 max-w-full" />
      <Skeleton className="mx-auto h-9 w-64" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    </div>
  );
}
