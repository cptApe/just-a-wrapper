import { AppError } from '@/lib/errors';
import { formatMoney } from '@/lib/format/format-money';
import { formatCount } from '@/lib/format/format-number';
import {
  type BillingInterval,
  effectiveYearlyMonthlyAmountCents,
  PLAN_TIERS,
  type PlanLimits,
  type PlanTier,
} from '../pricing-config';

/** One sellable Stripe price: a plan, an interval and a monthly credit package. */
export type PlanPack = {
  tier: PlanTier;
  interval: BillingInterval;
  credits: number;
  priceId: string;
  unitAmount: number;
  currency: string;
};

export type PlanChoice = { tier: PlanTier; interval: BillingInterval; credits: number };

export type CurrentPlan = {
  tier: PlanTier;
  interval: BillingInterval;
  credits: number | null;
  /** What the subscription charges each interval, as Stripe holds it. */
  amountCents: number | null;
};

export function findPack(packs: readonly PlanPack[], choice: PlanChoice): PlanPack | undefined {
  return packs.find(
    (pack) =>
      pack.tier === choice.tier &&
      pack.interval === choice.interval &&
      pack.credits === choice.credits,
  );
}

export type PackPrice = { monthlyCents: number; yearlyTotalCents: number | null };

// A yearly card shows the monthly equivalent, but its checkout still charges the whole year.
export function packPrice(pack: Pick<PlanPack, 'interval' | 'unitAmount'>): PackPrice {
  return pack.interval === 'year'
    ? {
        monthlyCents: effectiveYearlyMonthlyAmountCents(pack.unitAmount),
        yearlyTotalCents: pack.unitAmount,
      }
    : { monthlyCents: pack.unitAmount, yearlyTotalCents: null };
}

export function planLimitRows(limits: PlanLimits): { label: string; value: string }[] {
  return [
    { label: 'Chats at once', value: formatCount(limits.chatsAtOnce) },
    { label: 'Scheduled tasks', value: formatCount(limits.scheduledTasks) },
    {
      label: 'Team members',
      value: limits.members === null ? 'Unlimited' : formatCount(limits.members),
    },
  ];
}

export function isCurrentChoice(current: CurrentPlan | null, choice: PlanChoice): boolean {
  return (
    current !== null &&
    current.tier === choice.tier &&
    current.interval === choice.interval &&
    current.credits === choice.credits
  );
}

/**
 * When a change takes effect. A bigger plan, a bigger package and monthly to yearly start now
 * and charge the difference; everything else starts at the next renewal and charges nothing now.
 * The server decides with Stripe's own amounts; the dialog uses the same rule to label buttons.
 */
export function planChangeTiming(
  current: Pick<CurrentPlan, 'tier' | 'interval' | 'amountCents'>,
  target: { tier: PlanTier; interval: BillingInterval; amountCents: number },
): 'now' | 'next_renewal' {
  if (current.interval === 'year' && target.interval === 'month') return 'next_renewal';
  if (current.interval === 'month' && target.interval === 'year') return 'now';
  const rank = (tier: PlanTier) => PLAN_TIERS.indexOf(tier);
  if (rank(target.tier) > rank(current.tier)) return 'now';
  if (rank(target.tier) < rank(current.tier)) return 'next_renewal';
  return current.amountCents === null || target.amountCents > current.amountCents
    ? 'now'
    : 'next_renewal';
}

export function planButtonLabel(input: {
  planName: string;
  current: CurrentPlan | null;
  isCurrentPackage: boolean;
  isScheduled: boolean;
  tier: PlanTier;
  working: boolean;
}): string {
  if (input.working) return 'One moment…';
  if (input.isCurrentPackage) return 'Current plan';
  if (input.isScheduled) return 'Starts at renewal';
  if (input.current === null) return `Choose ${input.planName}`;
  return input.current.tier === input.tier ? 'Change package' : `Switch to ${input.planName}`;
}

export function planChangeMessage(effective: 'now' | 'next_renewal'): string {
  return effective === 'now'
    ? 'Your new plan starts now.'
    : 'Your new plan starts at your next renewal.';
}

// Expected refusals show the server's sentence without reporting; anything else is a fault.
const EXPECTED_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'VALIDATION_FAILED',
  'PLAN_LIMIT_REACHED',
  'CONFLICT',
]);

export type PlanChangeFailure = { message: string; report: boolean };

const PLAN_CHANGE_FAILED_MESSAGE = 'Could not change your plan. Try again.';

export function planChangeFailure(cause: unknown): PlanChangeFailure {
  if (!(cause instanceof AppError)) return { message: PLAN_CHANGE_FAILED_MESSAGE, report: true };
  const { serverCode, serverMessage } = cause.context;
  if (typeof serverCode !== 'string' || !EXPECTED_REFUSAL_CODES.has(serverCode)) {
    return { message: PLAN_CHANGE_FAILED_MESSAGE, report: true };
  }
  const sentence = typeof serverMessage === 'string' ? serverMessage.trim() : '';
  return { message: sentence === '' ? PLAN_CHANGE_FAILED_MESSAGE : sentence, report: false };
}

export function planSummaryLine(input: {
  planName: string;
  credits: number | null;
  interval: BillingInterval;
  priceCents?: number | null;
  currency?: string;
}): string {
  return [
    input.planName,
    ...(input.credits === null ? [] : [`${formatCount(input.credits)} credits a month`]),
    ...(input.priceCents === undefined || input.priceCents === null
      ? []
      : [`${formatMoney(input.priceCents, input.currency ?? 'usd')} a ${input.interval}`]),
  ].join(' · ');
}
