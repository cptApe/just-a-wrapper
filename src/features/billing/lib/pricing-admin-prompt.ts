import { formatAdminPrompt } from '@/lib/admin-prompt';
import { formatMoney } from '@/lib/format/format-money';
import { formatCount } from '@/lib/format/format-number';
import {
  AUTO_TOPUP,
  BILLING_CURRENCY,
  COST_ASSUMPTIONS,
  COST_SCALES,
  CREDIT_BLOCK,
  CREDIT_PACKAGES,
  MARGIN_PERCENT,
  PLAN_CREDITS_ROLL_OVER,
  PLAN_TIERS,
  PLANS,
  ROLLOVER_EXPIRY_MONTHS,
  STARTER_PACK_CREDITS,
  TOPUP_CREDIT_EXPIRY_MONTHS,
  VENDOR_BILLS,
  WELCOME_CREDITS,
  YEARLY_CHARGED_MONTHS,
  YEARLY_DELIVERED_MONTHS,
} from '../pricing-config';

import { catalogSentence } from './pricing-admin-model';

function planKnobLine(): string {
  return PLAN_TIERS.map((tier) => {
    const plan = PLANS[tier];
    const members =
      plan.limits.members === null ? 'no member limit' : `${plan.limits.members} members`;
    return `${plan.name} (minCredits ${formatCount(plan.minCredits)}, limits ${plan.limits.chatsAtOnce} chats at once, ${plan.limits.scheduledTasks} scheduled tasks, ${members})`;
  }).join('; ');
}

function vendorBillsLine(): string {
  const totals = COST_SCALES.map((scale) => {
    const cents = VENDOR_BILLS.reduce((sum, bill) => sum + bill.monthlyCents[scale.key], 0);
    return `${scale.label} ${formatMoney(cents, BILLING_CURRENCY)}`;
  }).join(', ');
  return `VENDOR_BILLS lists ${formatCount(VENDOR_BILLS.length)} services this product runs on, \
each estimated at three scales, and the monthly totals are ${totals}. \
COST_SCALES holds those three sizes, and COST_ASSUMPTIONS holds what one customer is assumed to do \
in a month (${formatCount(COST_ASSUMPTIONS.messagesPerCustomer)} messages, \
${COST_ASSUMPTIONS.storedGigabytesPerCustomer} gigabytes stored, \
${formatCount(COST_ASSUMPTIONS.emailsAndNotificationsPerCustomer)} emails and notifications)`;
}

// The dashboard does not mutate configuration; prompts must carry current names and values for the terminal agent.
export function pricingAdminPromptText(): string {
  const rollover = rolloverConfigurationSentence(PLAN_CREDITS_ROLL_OVER);

  return formatAdminPrompt({
    where: 'src/features/billing/pricing-config.ts, the only file that holds a price',
    what: `Change what this product charges. These are the knobs and what they are set to now. \
MARGIN_PERCENT ${MARGIN_PERCENT}, the share of every dollar you keep. CREDIT_BLOCK ${formatCount(CREDIT_BLOCK)}, \
the credit package increment. PLANS: ${planKnobLine()}. CREDIT_PACKAGES: \
${CREDIT_PACKAGES.map((credits) => formatCount(credits)).join(', ')}. STARTER_PACK_CREDITS \
${formatCount(STARTER_PACK_CREDITS)}, the smallest one-time purchase and how far the credit stepper moves. YEARLY_CHARGED_MONTHS \
${YEARLY_CHARGED_MONTHS} against YEARLY_DELIVERED_MONTHS ${YEARLY_DELIVERED_MONTHS}. ${rollover}. \
TOPUP_CREDIT_EXPIRY_MONTHS ${TOPUP_CREDIT_EXPIRY_MONTHS}, how long bought credits last. \
WELCOME_CREDITS ${formatCount(WELCOME_CREDITS)}, what a new account gets once. AUTO_TOPUP: \
thresholdCredits ${formatCount(AUTO_TOPUP.thresholdCredits)}, defaultCredits \
${formatCount(AUTO_TOPUP.defaultCredits)}, failedCooldownHours ${AUTO_TOPUP.failedCooldownHours}. \
${vendorBillsLine()}. Ask me which of these to change, then change only those.`,
    guardrails: [
      'Keep every money value a whole number of cents',
      'Change prices only in pricing-config.ts, never in a component, a route, a doc, or the Stripe script',
      'Never edit credit-math.ts to reprice; it holds what vendors charge, and MARGIN_PERCENT is the price knob',
      'Keep every credit package and every plan minimum a positive multiple of CREDIT_BLOCK',
      'Do not change an existing workspace setting when changing the defaults for new workspaces',
      'Do not run the Stripe seed without my clear approval, because it changes my Stripe account',
    ],
    verify: [
      'Load the customize-pricing skill before editing',
      'pnpm validate:config',
      'pnpm verify',
      'Reload /admin/pricing and check it says Stripe matches your prices',
    ],
  });
}

export function stripeSeedPromptText(): string {
  return formatAdminPrompt({
    where: 'scripts/seed-stripe.ts, Stripe test prices',
    what: `This changes my Stripe account. After I approve it, run \`pnpm seed:stripe\` to make Stripe \
match the prices in this project: ${catalogSentence()} Each subscription buys one package, with quantity 1. Top-ups use an inline price for the total.`,
    guardrails: [
      'Use Stripe test mode only. Never use a live key',
      'Ask for my clear approval immediately before running the command',
      'Keep every price that already matches and replace only prices that are out of date',
      'Change pricing-config.ts first when the intended customer price is wrong',
    ],
    verify: [
      'Run `STRIPE_SECRET_KEY= pnpm seed:stripe` first to preview the changes without writing to Stripe',
      'Reload this page and check it says Stripe matches your prices',
    ],
  });
}

function rolloverConfigurationSentence(isEnabled: boolean): string {
  return isEnabled
    ? `PLAN_CREDITS_ROLL_OVER is on, so monthly credits live ROLLOVER_EXPIRY_MONTHS ${ROLLOVER_EXPIRY_MONTHS} months`
    : `PLAN_CREDITS_ROLL_OVER is off, so monthly credits expire at renewal (ROLLOVER_EXPIRY_MONTHS ${ROLLOVER_EXPIRY_MONTHS} only applies when it is on)`;
}
