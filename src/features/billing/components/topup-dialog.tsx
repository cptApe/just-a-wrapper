'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconMinus, IconPlus } from '@/components/icons';
import { useOrganizationId } from '@/components/providers/app-providers';
import { usePlansForSale } from '@/components/providers/deployment-capabilities-provider';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
// Type-only import — erased at compile time, so the registry→overlay→registry
// module loop never exists at runtime.
import type { OverlayComponentProps } from '@/features/overlays';
import { useOverlayCloseGuard } from '@/features/overlays/hooks/use-overlay-close-guard';
import { openOverlay } from '@/features/overlays/lib/overlay-history';
import { AppError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import { formatMoney } from '@/lib/format/format-money';
import { formatCount } from '@/lib/format/format-number';
import { captureException } from '@/lib/observability-client';
import { billingQueryKeys } from '../api/keys';
import { type TopupFailure, useTopupPurchase } from '../hooks/use-topup-purchase';
import { parseBillingResponse, topupOptionsSchema } from '../lib/billing-response';
import {
  BILLING_CURRENCY,
  isTopupCredits,
  MARGIN_PERCENT,
  STARTER_PACK_CREDITS,
  STRIPE_MAX_CHARGE_CENTS,
  TOPUP_CREDIT_EXPIRY_MONTHS,
  wholeCreditsCents,
} from '../pricing-config';
import { CardBrandIcon } from './card-brand-icon';

const PORTAL_HREF = '/api/billing/portal';

// "At cost" is true only while the margin is zero; a fork with a margin says how long credits last.
const TOPUP_DESCRIPTION =
  MARGIN_PERCENT === 0
    ? 'Buy credits at API cost, with no markup.'
    : `Buy credits once. They last ${TOPUP_CREDIT_EXPIRY_MONTHS} months.`;

function price(credits: number): string {
  return formatMoney(wholeCreditsCents(credits), BILLING_CURRENCY);
}

function amountProblem(credits: number): string | null {
  if (credits < STARTER_PACK_CREDITS)
    return `Minimum is ${formatCount(STARTER_PACK_CREDITS)} credits.`;
  if (isTopupCredits(credits)) return null;
  return `One charge can be at most ${formatMoney(STRIPE_MAX_CHARGE_CENTS, BILLING_CURRENCY)}.`;
}

function optionsProblem(cause: unknown): { message: string; canRetry: boolean } {
  const serverCode = cause instanceof AppError ? cause.context.serverCode : undefined;
  if (serverCode === 'FORBIDDEN')
    return { message: 'Only workspace owners and admins can buy credits.', canRetry: false };
  if (serverCode === 'INTEGRATION_NOT_CONNECTED')
    return { message: 'Payments are off. This server has no Stripe key.', canRetry: false };
  return { message: 'Could not load your card.', canRetry: true };
}

export function TopupOverlay({ open, onClose }: OverlayComponentProps) {
  const organizationId = useOrganizationId();
  if (organizationId === null) return null;
  return (
    <TopupDialog
      open={open}
      onClose={onClose}
      expectedOrganizationId={organizationId}
      title="Add credits"
    />
  );
}

export function TopupDialog({
  open,
  onClose,
  expectedOrganizationId,
  title,
}: {
  open: boolean;
  onClose: () => void;
  expectedOrganizationId: string;
  title: string;
}) {
  const [amount, setAmount] = useState(String(STARTER_PACK_CREDITS));
  const credits = Number(amount);
  const purchase = useTopupPurchase({
    expectedOrganizationId,
    onClose: () => {
      releaseCloseGuard();
      onClose();
    },
  });
  const { failure, pending, clearFailure } = purchase;
  const releaseCloseGuard = useOverlayCloseGuard(pending);
  const options = useQuery({
    queryKey: billingQueryKeys.topupOptions(expectedOrganizationId),
    queryFn: async () =>
      parseBillingResponse(topupOptionsSchema, await fetchJson('/api/billing/topup')),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const loadFailed = options.isError && !options.isFetching;
  useEffect(() => {
    if (loadFailed) captureException(options.error, { feature: 'billing', op: 'topup-options' });
  }, [loadFailed, options.error]);

  const details = loadFailed ? undefined : options.data;
  const plansForSale = usePlansForSale();
  const waitingForCard = details === undefined && !loadFailed;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (next || pending) return;
        clearFailure();
        onClose();
      }}
      presentation="dialog"
      size="sm"
      className="max-w-100"
    >
      <ModalHeader className="min-h-0 pb-0 pt-4">
        <ModalTitle>{title}</ModalTitle>
      </ModalHeader>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          if (details && !pending && isTopupCredits(credits)) {
            void purchase.pay(credits, details.workspaceId);
          }
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ModalContent className="items-center pb-0 text-center">
          <ModalDescription>{TOPUP_DESCRIPTION}</ModalDescription>
          {/* Where plans are sold, a workspace without one can pick one instead; the line is
              reserved so the stepper does not move when the answer arrives. */}
          {plansForSale ? (
            <div className="flex min-h-6 items-center justify-center">
              {details?.offersPlans ? (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto"
                  disabled={pending}
                  onClick={() => openOverlay('plans')}
                >
                  Or choose a monthly plan
                </Button>
              ) : null}
            </div>
          ) : null}
          <CreditStepper
            amount={amount}
            credits={credits}
            disabled={pending}
            onChange={(next) => {
              setAmount(next);
              clearFailure();
            }}
          />
          {/* Two reserved lines hold the amount rule and the longest failure, so nothing moves. */}
          <div className="flex min-h-9 flex-wrap items-center justify-center gap-x-2 text-balance text-meta">
            <PurchaseStatus
              failure={failure}
              problem={loadFailed ? optionsProblem(options.error) : null}
              amountProblem={amountProblem(credits)}
              onRetry={() => void options.refetch()}
            />
          </div>
        </ModalContent>
        {/* The reversed column draws the saved card under the action while it stays in the left slot. */}
        <ModalFooter
          className="flex-col-reverse items-stretch gap-2.5 pt-2"
          left={
            waitingForCard || details?.savedCard ? (
              <FooterCard waiting={waitingForCard} savedCard={details?.savedCard} />
            ) : undefined
          }
        >
          {failure?.changeCard ? (
            <Button asChild size="lg" className="w-full">
              <a href={PORTAL_HREF}>Change card</a>
            </Button>
          ) : waitingForCard ? (
            // The label depends on the saved card, so it stays hidden until the card is known.
            <Skeleton className="h-11 w-full rounded-button" aria-hidden />
          ) : (
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={pending || details === undefined || !isTopupCredits(credits)}
            >
              {payLabel({ credits, pending, hasNoCard: details?.savedCard === null })}
            </Button>
          )}
        </ModalFooter>
      </Form>
    </Modal>
  );
}

function payLabel(input: { credits: number; pending: boolean; hasNoCard: boolean }): string {
  if (input.pending) return input.hasNoCard ? 'Opening…' : 'Paying…';
  return input.hasNoCard
    ? `Add card and pay ${price(input.credits)}`
    : `Pay ${price(input.credits)}`;
}

function CreditStepper({
  amount,
  credits,
  disabled,
  onChange,
}: {
  amount: string;
  credits: number;
  disabled: boolean;
  onChange: (amount: string) => void;
}) {
  const stepUp = credits + STARTER_PACK_CREDITS;
  const stepDown = Math.max(credits - STARTER_PACK_CREDITS, STARTER_PACK_CREDITS);
  return (
    // The capped middle column keeps the steppers still as the amount gains digits.
    <div
      role="group"
      aria-label="Credits to buy"
      className="mt-7 grid w-full grid-cols-[auto_minmax(0,11rem)_auto] items-center justify-center gap-x-2"
    >
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label={`Remove ${formatCount(STARTER_PACK_CREDITS)} credits`}
        disabled={disabled || credits <= STARTER_PACK_CREDITS}
        onClick={() => onChange(String(stepDown))}
      >
        <IconMinus />
      </Button>
      <CreditAmountField amount={amount} disabled={disabled} onChange={onChange} />
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label={`Add ${formatCount(STARTER_PACK_CREDITS)} credits`}
        disabled={disabled || !isTopupCredits(stepUp)}
        onClick={() => onChange(String(stepUp))}
      >
        <IconPlus />
      </Button>
      <span className="col-span-full mt-1 text-body text-muted-foreground">credits</span>
    </div>
  );
}

// Nine digits reach past Stripe's ceiling, so an oversized amount gets its message.
const AMOUNT_MAX_DIGITS = 9;

function CreditAmountField({
  amount,
  disabled,
  onChange,
}: {
  amount: string;
  disabled: boolean;
  onChange: (amount: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  // Grouping digits only while the field is idle keeps the caret where the person left it.
  const shown = focused || amount === '' ? amount : formatCount(Number(amount));
  // Selection runs after the render that swaps the grouped text for plain digits.
  useLayoutEffect(() => {
    if (focused) inputRef.current?.select();
  }, [focused]);
  return (
    <input
      ref={inputRef}
      type="text"
      data-no-autofocus
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      aria-label="Credits"
      maxLength={AMOUNT_MAX_DIGITS}
      disabled={disabled}
      value={shown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => {
        // eslint-disable-next-line just-a-wrapper/require-form-primitive -- Typing an amount and pressing Enter never charges the card; paying stays a deliberate press or Cmd+Enter.
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) event.preventDefault();
      }}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, ''))}
      className="h-11 w-full min-w-0 rounded-button bg-transparent text-center text-title-page tabular-nums outline-none transition-colors duration-150 ease-[var(--ease-out)] hover:bg-alpha-6 focus:bg-alpha-6 disabled:opacity-50"
    />
  );
}

function PurchaseStatus({
  failure,
  problem,
  amountProblem,
  onRetry,
}: {
  failure: TopupFailure | null;
  problem: { message: string; canRetry: boolean } | null;
  amountProblem: string | null;
  onRetry: () => void;
}) {
  if (failure) {
    return (
      <p role="alert" className="text-destructive">
        {failure.message}
      </p>
    );
  }
  if (problem) {
    return (
      <>
        <p role="alert" className="text-muted-foreground">
          {problem.message}
        </p>
        {problem.canRetry ? (
          <Button type="button" variant="link" size="xs" className="h-auto" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </>
    );
  }
  if (amountProblem) return <p className="text-muted-foreground">{amountProblem}</p>;
  return null;
}

// One reserved line holds the skeleton, the saved card or nothing, so the footer never changes height.
function FooterCard({
  waiting,
  savedCard,
}: {
  waiting: boolean;
  savedCard: { brand: string | null; last4: string | null } | null | undefined;
}) {
  return (
    <span className="flex min-h-[18px] w-full min-w-0 items-center justify-center gap-1.5 text-meta text-muted-foreground">
      {waiting ? (
        <Skeleton className="h-3.5 w-24" aria-hidden />
      ) : savedCard ? (
        <>
          <span className="sr-only">Charged to</span>
          <CardBrandIcon brand={savedCard.brand} />
          <span className="truncate tabular-nums">
            {savedCard.last4 ? `•••• ${savedCard.last4}` : 'Saved method'}
          </span>
        </>
      ) : null}
    </span>
  );
}
