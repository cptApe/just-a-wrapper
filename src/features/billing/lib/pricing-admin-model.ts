import { formatMoney, formatVendorRate } from '@/lib/format/format-money';
import { formatCount, formatPercent } from '@/lib/format/format-number';
import { plural } from '@/lib/format/plural';
import {
  AUTO_TOPUP,
  BILLING_CURRENCY,
  CENTS_PER_CREDIT,
  CREDIT_BLOCK,
  CREDIT_PACKAGES,
  creditBlockPriceCents,
  creditPriceCents,
  MARGIN_PERCENT,
  PLAN_TIERS,
  PLANS,
  type PlanTier,
  packagesForPlan,
  planAmountCents,
  WELCOME_CREDITS,
  YEARLY_CHARGED_MONTHS,
  YEARLY_DELIVERED_MONTHS,
} from '../pricing-config';
import { boughtCreditsRule, monthlyCreditsRule, welcomeCreditsRule } from './credit-rules-copy';
import { buildIntendedCatalog } from './stripe-plan';

export type ValueRow = { label: string; value: string };

function membersPhrase(members: number | null): string {
  return members === null ? 'No limit' : formatCount(members);
}

export type MarginSummary = {
  percent: number;
  headline: string;
  sentence: string;
  rows: ValueRow[];
};

// Admin UI and markdown share these derived values so their prices cannot drift.
export function marginSummary(): MarginSummary {
  const keptCentsPerDollar = Math.round(MARGIN_PERCENT);
  return {
    percent: MARGIN_PERCENT,
    headline: formatPercent(MARGIN_PERCENT),
    sentence: `Of every dollar a customer pays, ${keptCentsPerDollar} cents stay with you, before Stripe takes its fee.`,
    rows: [
      {
        label: 'What a credit costs you',
        value: formatVendorRate(CENTS_PER_CREDIT, BILLING_CURRENCY),
      },
      {
        label: 'What a credit sells for',
        value: formatVendorRate(creditPriceCents(), BILLING_CURRENCY),
      },
      {
        label: `What ${formatCount(CREDIT_BLOCK)} credits cost a customer`,
        value: formatMoney(creditBlockPriceCents(), BILLING_CURRENCY),
      },
    ],
  };
}

export type PlanColumn = { tier: PlanTier; name: string; description: string };

export type PlanTableRow = { label: string; valuesByTier: Record<PlanTier, string> };

export type PackageRow = {
  credits: number;
  creditsLabel: string;
  monthlyPrice: string;
  plans: string;
};

export function planColumns(): PlanColumn[] {
  return PLAN_TIERS.map((tier) => ({
    tier,
    name: PLANS[tier].name,
    description: PLANS[tier].description,
  }));
}

function byTier(value: (tier: PlanTier) => string): Record<PlanTier, string> {
  return { pro: value('pro'), max: value('max') };
}

export function planTableRows(): PlanTableRow[] {
  return [
    {
      label: 'Starts at',
      valuesByTier: byTier((tier) => {
        const credits = PLANS[tier].minCredits;
        return `${plural(credits, 'credit')}, ${formatMoney(planAmountCents(credits, 'month'), BILLING_CURRENCY)} a month`;
      }),
    },
    {
      label: 'Chats at once',
      valuesByTier: byTier((tier) => formatCount(PLANS[tier].limits.chatsAtOnce)),
    },
    {
      label: 'Scheduled tasks',
      valuesByTier: byTier((tier) => formatCount(PLANS[tier].limits.scheduledTasks)),
    },
    {
      label: 'Team members',
      valuesByTier: byTier((tier) => membersPhrase(PLANS[tier].limits.members)),
    },
  ];
}

// Plans differ in limits and minimum package, not the price of a credit.
export function packageRows(): PackageRow[] {
  return CREDIT_PACKAGES.map((credits) => {
    const plans = PLAN_TIERS.filter((tier) => packagesForPlan(tier).includes(credits));
    return {
      credits,
      creditsLabel: plural(credits, 'credit'),
      monthlyPrice: `${formatMoney(planAmountCents(credits, 'month'), BILLING_CURRENCY)} a month`,
      plans: plans.map((tier) => PLANS[tier].name).join(' and '),
    };
  });
}

export function planNotes(): string[] {
  const notes = [
    `Yearly billing charges for ${YEARLY_CHARGED_MONTHS} months and delivers ${YEARLY_DELIVERED_MONTHS}.`,
  ];
  const welcome = welcomeCreditsRule();
  if (welcome) notes.push(welcome);
  return notes;
}

export function creditRuleRows(): ValueRow[] {
  return [
    { label: 'Monthly credits', value: monthlyCreditsRule() },
    { label: 'Bought credits', value: boughtCreditsRule() },
    {
      label: 'Welcome credits',
      value:
        welcomeCreditsRule() === null
          ? 'A new account gets no credits, so nothing runs until it buys some or picks a plan.'
          : `A new account gets ${plural(WELCOME_CREDITS, 'credit')} once, before it picks a plan.`,
    },
    {
      label: 'Auto top-up starts at',
      value: `${plural(AUTO_TOPUP.thresholdCredits, 'credit')} to begin with. Customers change it in Billing settings.`,
    },
    {
      label: 'Auto top-up adds',
      value: `${plural(AUTO_TOPUP.defaultCredits, 'credit')} to begin with. Customers change it in Billing settings.`,
    },
    {
      label: 'Auto top-up monthly limit',
      value: `Customers set it in Billing settings, at least $1 while the switch is on and up to ${formatMoney(AUTO_TOPUP.maxMonthlyCapCents, BILLING_CURRENCY)} a month.`,
    },
    {
      label: 'After a declined card',
      value: `A card that declines is left alone for ${formatCount(AUTO_TOPUP.failedCooldownHours)} hours before the next try. The same for every customer.`,
    },
  ];
}

export function catalogSentence(): string {
  return `${formatCount(buildIntendedCatalog().length)} prices: one for each plan, billing period and credit package. Bought credits use an inline price for the total.`;
}
