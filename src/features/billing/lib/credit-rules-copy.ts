import { formatMoney } from '@/lib/format/format-money';
import { formatCount } from '@/lib/format/format-number';
import {
  PLAN_CREDITS_ROLL_OVER,
  ROLLOVER_EXPIRY_MONTHS,
  TOPUP_CREDIT_EXPIRY_MONTHS,
  WELCOME_CREDITS,
} from '../pricing-config';

// These are configurable policies, not literal states; every sentence must follow a fork's pricing configuration.
const policy: {
  rollover: boolean;
  rolloverMonths: number;
  topupMonths: number;
  welcomeCredits: number;
} = {
  rollover: PLAN_CREDITS_ROLL_OVER,
  rolloverMonths: ROLLOVER_EXPIRY_MONTHS,
  topupMonths: TOPUP_CREDIT_EXPIRY_MONTHS,
  welcomeCredits: WELCOME_CREDITS,
};

function monthsWord(months: number): string {
  return months === 1 ? 'one month' : months === 2 ? 'two months' : `${months} months`;
}

export function monthlyCreditsRule(): string {
  return policy.rollover
    ? `Unused monthly credits carry over for ${monthsWord(policy.rolloverMonths)}.`
    : 'Unused monthly credits do not carry over.';
}

export function boughtCreditsRule(): string {
  return policy.topupMonths === 12
    ? 'Credits you buy last a year.'
    : `Credits you buy last ${monthsWord(policy.topupMonths)}.`;
}

export function welcomeCreditsRule(): string | null {
  return policy.welcomeCredits > 0
    ? `New accounts start with ${formatCount(policy.welcomeCredits)} credits to try things out.`
    : null;
}

export function autoTopupRule(
  thresholdCredits: number,
  credits: number,
  monthlyCapDollars: number,
): string {
  const cap = formatMoney(Math.round(monthlyCapDollars * 100), 'usd');
  return `When your balance drops to ${formatCount(thresholdCredits)} credits we add ${formatCount(credits)} more, up to ${cap} a month.`;
}
