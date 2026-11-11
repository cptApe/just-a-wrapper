import { AGENT_TIER_LIST, TIER_DISPLAY } from '@/features/agents/config';
import type { AgentTier } from '@/features/agents/types';
import { formatMoney, formatVendorRate } from '@/lib/format/format-money';
import { formatCount } from '@/lib/format/format-number';
import { plural } from '@/lib/format/plural';
import { BILLING_CURRENCY, CENTS_PER_CREDIT, creditPriceCents } from '../pricing-config';
import { browserSessionVendorCostCents } from './browser-session-math';
import {
  CONTAINER_CENTS_PER_HOUR,
  containerRuntimeCents,
  creditsForVendorCents,
  MODEL_PRICING_CENTS,
  modelRequestCents,
} from './credit-math';

const SECONDS_PER_HOUR = 3_600;

// The representative token counts behind the displayed per-turn cost estimate.
const TYPICAL_TURN = { inputTokens: 20_000, outputTokens: 1_000 } as const;

export type ChargeRow = {
  key: string;
  label: string;
  detail: string;
  vendorRate: string;
  credits: string;
  creditCount: number;
  customerPaid: string;
};

export const CHARGE_FOOTNOTE = 'Everything is billed at cost, then your margin.';

export const CHARGE_COLUMNS = {
  vendorRate: 'Costs you',
  credits: 'Customer uses',
  customerPaid: 'Customer paid',
} as const;

function centsWord(cents: number): string {
  if (!Number.isInteger(cents) || cents >= 100) return formatVendorRate(cents, BILLING_CURRENCY);
  return cents === 1 ? 'one cent' : `${cents} cents`;
}

function customerPaidFor(credits: number): string {
  return formatVendorRate(credits * creditPriceCents(), BILLING_CURRENCY);
}

export function chargesExplained(): string[] {
  const balanced = modelChargeRow('default', '');
  return [
    `One credit is ${centsWord(CENTS_PER_CREDIT)} of your cost, so the credits a customer uses are what it cost you. They buy credits at ${centsWord(creditPriceCents())} each: a ${balanced.label} turn costs you about ${centsWord(balanced.creditCount * CENTS_PER_CREDIT)} and cost them ${centsWord(balanced.creditCount * creditPriceCents())}.`,
  ];
}

export function typicalTurnSentence(): string {
  return `A typical turn sends ${formatCount(TYPICAL_TURN.inputTokens)} tokens in and gets ${formatCount(TYPICAL_TURN.outputTokens)} back.`;
}

function modelChargeRow(tier: AgentTier, model: string): ChargeRow {
  const pricing = MODEL_PRICING_CENTS[tier];
  const credits = creditsForVendorCents(
    modelRequestCents(tier, {
      inputTokens: TYPICAL_TURN.inputTokens,
      outputTokens: TYPICAL_TURN.outputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    }),
  );
  return {
    key: `model-${tier}`,
    label: TIER_DISPLAY[tier].label,
    detail: model,
    vendorRate: `${formatMoney(pricing.inputPerMTok, BILLING_CURRENCY)} in and ${formatMoney(pricing.outputPerMTok, BILLING_CURRENCY)} out per million tokens`,
    credits: `About ${plural(credits, 'credit')} a turn`,
    creditCount: credits,
    customerPaid: customerPaidFor(credits),
  };
}

type MeteredRow = Omit<ChargeRow, 'creditCount'>;
const METERED_ROWS = [
  { key: 'image', label: 'Image' },
  { key: 'video', label: 'Video' },
  { key: 'dictation', label: 'Dictation' },
  { key: 'read-aloud', label: 'Read aloud' },
] as const;

export function chargeRows(): (ChargeRow | MeteredRow)[] {
  const browserHourCents = browserSessionVendorCostCents(SECONDS_PER_HOUR);
  const sandboxHourCredits = creditsForVendorCents(containerRuntimeCents(SECONDS_PER_HOUR));
  return [
    ...AGENT_TIER_LIST.map(({ tier, model }) => modelChargeRow(tier, model)),
    {
      key: 'sandbox',
      label: 'An hour of sandbox time',
      detail: 'The computer your agent runs on while it works',
      vendorRate: formatVendorRate(CONTAINER_CENTS_PER_HOUR, BILLING_CURRENCY),
      credits: plural(sandboxHourCredits, 'credit'),
      creditCount: sandboxHourCredits,
      customerPaid: customerPaidFor(sandboxHourCredits),
    },
    {
      key: 'browser',
      label: 'An hour of browser time',
      detail: 'The browser your agent drives to read and click',
      vendorRate: formatVendorRate(browserHourCents, BILLING_CURRENCY),
      credits: plural(creditsForVendorCents(browserHourCents), 'credit'),
      creditCount: creditsForVendorCents(browserHourCents),
      customerPaid: customerPaidFor(creditsForVendorCents(browserHourCents)),
    },
    ...METERED_ROWS.map((row) => ({
      ...row,
      detail: 'Actual Gateway cost; estimate only if usage lookup fails',
      vendorRate: 'Actual request cost',
      credits: `Charged at ${centsWord(CENTS_PER_CREDIT)} per credit, rounded up`,
      customerPaid: 'Based on credits used',
    })),
  ];
}
