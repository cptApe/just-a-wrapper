import { formatMoney } from '@/lib/format/format-money';
import { formatCount } from '@/lib/format/format-number';
import { plural } from '@/lib/format/plural';
import {
  BILLING_CURRENCY,
  COST_ASSUMPTIONS,
  COST_SCALES,
  type CostScale,
  creditsCostCents,
  PLAN_TIERS,
  PLANS,
  planAmountCents,
  VENDOR_BILLS,
} from '../pricing-config';

export type ScaleColumn = { key: CostScale; label: string; customers: number };

export type VendorBillRow = {
  name: string;
  role: string;
  grows: string;
  pricingUrl: string;
  valuesByScale: Record<CostScale, string>;
};

export type BillTotal = { cents: number; money: string };

export const COST_SCALE_COLUMNS: readonly ScaleColumn[] = COST_SCALES.map((scale) => ({
  key: scale.key,
  label: scale.label,
  customers: scale.customers,
}));

export const NO_VENDOR_BILLS = 'No vendor bills listed yet';

function byScale<T>(value: (scale: CostScale) => T): Record<CostScale, T> {
  return { starting: value('starting'), growing: value('growing'), busy: value('busy') };
}

function billCell(cents: number): string {
  return cents === 0 ? 'Free tier' : formatMoney(cents, BILLING_CURRENCY);
}

function gigabytesPhrase(gigabytes: number): string {
  if (gigabytes === 0.5) return 'half a gigabyte';
  if (gigabytes === 1) return 'a gigabyte';
  return `${formatCount(gigabytes)} gigabytes`;
}

export function vendorBillsIntro(): string[] {
  return [
    'Usage your customers cause directly, model tokens, sandbox and browser hours, media, and voice, is charged to them in credits and is not in this list.',
    'These are the bills that arrive on top of that.',
    `Estimates assume each paying customer sends about ${formatCount(COST_ASSUMPTIONS.messagesPerCustomer)} messages, keeps about ${gigabytesPhrase(COST_ASSUMPTIONS.storedGigabytesPerCustomer)} of files, and gets about ${formatCount(COST_ASSUMPTIONS.emailsAndNotificationsPerCustomer)} emails and notifications a month. Replace them with your real bills in the config.`,
  ];
}

export function vendorBillRows(): VendorBillRow[] {
  return VENDOR_BILLS.map((bill) => ({
    name: bill.name,
    role: bill.role,
    grows: bill.grows,
    pricingUrl: bill.pricingUrl,
    valuesByScale: byScale((scale) => billCell(bill.monthlyCents[scale])),
  }));
}

export function billTotals(): Record<CostScale, BillTotal> {
  return byScale((scale) => {
    const cents = VENDOR_BILLS.reduce((sum, bill) => sum + bill.monthlyCents[scale], 0);
    return { cents, money: billCell(cents) };
  });
}

// Assume every purchased credit is spent when estimating subscriptions needed to cover vendor bills.
function keptPerSubscriptionCents(): number {
  const credits = PLANS[PLAN_TIERS[0]].minCredits;
  return planAmountCents(credits, 'month') - creditsCostCents(credits);
}

// A subscription that keeps nothing covers no bill, however many of them there are.
export function customersToCover(): Record<CostScale, string> {
  const kept = keptPerSubscriptionCents();
  const totals = billTotals();
  return byScale((scale) => {
    const { cents } = totals[scale];
    if (cents === 0) return formatCount(0);
    return kept > 0 ? formatCount(Math.ceil(cents / kept)) : 'None at this margin';
  });
}

export function billSummaryLabels(): { total: string; cover: string } {
  return {
    total: 'All bills',
    cover: `${PLANS[PLAN_TIERS[0]].name} customers to cover them`,
  };
}

export function keptPerSubscriptionSentence(): string {
  const tier = PLAN_TIERS[0];
  return `You keep ${formatMoney(keptPerSubscriptionCents(), BILLING_CURRENCY)} of every ${PLANS[tier].name} subscription at ${plural(PLANS[tier].minCredits, 'credit')}.`;
}
