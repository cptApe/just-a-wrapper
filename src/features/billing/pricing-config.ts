// Operator commercial values and conservative media preflight estimates live here. Checkout,
// the Stripe seed, credit grants, the customer billing pages, and the admin
// Pricing page all derive from these values, so changing the economics of a
// fork is one deliberate edit here.
//
// The model, in four sentences. One credit is one cent of vendor cost, the same
// credit on every plan. One margin percent turns cost into price. Two plans
// differ by limits and by the smallest credit package they start at, never by
// the price of a credit. Stripe holds one price per plan, interval and credit
// package, with quantity one; top-ups use an inline price for the total.
// Plans are sold only in subscription mode (decision 0047).
import { BillingError } from '@/lib/errors';

export const BILLING_CURRENCY = 'usd' as const;

// ---------------------------------------------------------------------------
// The unit
// ---------------------------------------------------------------------------

/**
 * What one credit represents on the cost side: one cent of vendor spend
 * (model tokens, sandbox time, browser time, media, voice, web search). A session
 * rounds its running vendor cost up to whole units of this number once (decision 0031).
 * It is the burn unit, not a price. Do not change it to reprice the product;
 * change MARGIN_PERCENT.
 */
export const CENTS_PER_CREDIT = 1;

// A session's first priced request rounds its total up to one whole credit, even
// on the cheapest model; require that floor before an interactive turn starts.
export const MIN_TURN_CREDITS = 1;

/**
 * Of every dollar a customer pays, this share stays with the operator. The
 * rest covers vendor cost. This is the only pricing knob: the price of a
 * credit, every plan price, and every top-up price derive from it.
 * Zero means customers get a credit for every cent they pay. Allowed range: 0 to 95.
 */
export const MARGIN_PERCENT: number = 0;

/**
 * Credit package granularity. Every package and plan minimum is a multiple
 * of this size. This is a pricing calculation unit, not a Stripe quantity.
 */
export const CREDIT_BLOCK = 100;

// ---------------------------------------------------------------------------
// The plans
// ---------------------------------------------------------------------------

export type PlanLimits = {
  /** Chats that can be running at the same time in the workspace. */
  chatsAtOnce: number;
  /** Largest single file a member can store. */
  fileSizeBytes: number;
  /** Scheduled tasks the workspace can have. */
  scheduledTasks: number;
  /** Members the workspace can have, owner included. `null` means no limit. */
  members: number | null;
};

export const PLANS = {
  pro: {
    name: 'Pro',
    description: 'For one person doing real work',
    /** The smallest credit package this plan starts at. */
    minCredits: 1_000,
    limits: { fileSizeBytes: 100 * 1024 * 1024, chatsAtOnce: 3, scheduledTasks: 5, members: 5 },
  },
  max: {
    name: 'Max',
    description: 'For teams and heavy use',
    minCredits: 5_000,
    limits: {
      fileSizeBytes: 500 * 1024 * 1024,
      chatsAtOnce: 10,
      scheduledTasks: 50,
      members: null,
    },
  },
} as const satisfies Record<
  string,
  { name: string; description: string; minCredits: number; limits: PlanLimits }
>;

export type PlanTier = keyof typeof PLANS;
export const PLAN_TIERS = ['pro', 'max'] as const satisfies readonly PlanTier[];

/** A workspace's plan column: a paid plan, or no plan at all. */
export type WorkspacePlan = PlanTier | 'none';

export function isPlanTier(value: string): value is PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(value);
}

/**
 * What a workspace without a plan can do in subscription mode, while it spends credits it
 * bought. A plan lifts these. Credits-only mode gives a plan-less workspace the top plan's
 * limits instead (src/features/billing/credits-only).
 */
export const NO_PLAN_LIMITS: PlanLimits = {
  fileSizeBytes: 25 * 1024 * 1024,
  chatsAtOnce: 1,
  scheduledTasks: 0,
  members: 1,
};

// A deployment without billing sells nothing, so no plan caps its workspaces. The file size is
// the storage provider's own object ceiling.
export const UNLIMITED_PLAN_LIMITS: PlanLimits = {
  fileSizeBytes: 5 * 1024 ** 4,
  chatsAtOnce: 1_000_000,
  scheduledTasks: 1_000_000,
  members: null,
};

/** The plan the plan dialog cannot go past; a limit there points at nothing bigger. */
export const TOP_PLAN_TIER: PlanTier = 'max';

/**
 * Monthly credit packages a customer can pick, on either plan. A plan offers
 * the packages at or above its minimum. Extend the list to sell bigger ones;
 * there is no ceiling in Stripe, only in this list.
 */
export const CREDIT_PACKAGES = [
  1_000, 1_500, 2_000, 3_000, 5_000, 7_500, 10_000, 15_000, 20_000, 30_000, 50_000,
] as const;

/**
 * The cheap way in: the smallest one-time purchase, and how far the credit
 * stepper moves. A customer can also type any whole number above it. It is sold
 * only as a top-up, so it adds no Stripe price and stays out of auto top-up,
 * where its card fee would repeat. It costs $5.00 at the current margin and
 * need not be a whole number of blocks.
 */
export const STARTER_PACK_CREDITS = 500;

/**
 * Not a price knob. Stripe caps the amount by digits: non-card methods in most
 * currencies take 8, and cards take 9 or more, so 8 digits holds on every path
 * a one-time purchase can take. https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts
 */
export const STRIPE_MAX_CHARGE_CENTS = 99_999_999;

/** The one rule for what a customer can buy once. The server enforces it on every purchase. */
export function isTopupCredits(credits: number): boolean {
  return (
    Number.isInteger(credits) &&
    credits >= STARTER_PACK_CREDITS &&
    wholeCreditsCents(credits) <= STRIPE_MAX_CHARGE_CENTS
  );
}

export function packagesForPlan(tier: PlanTier): number[] {
  return CREDIT_PACKAGES.filter((credits) => credits >= PLANS[tier].minCredits);
}

// ---------------------------------------------------------------------------
// Intervals and yearly billing
// ---------------------------------------------------------------------------

export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

// Yearly billing: customers receive 12 months while paying for 10. Keeping
// charged and delivered months explicit keeps the yearly price auditable and
// avoids a floating-point percentage.
export const YEARLY_DELIVERED_MONTHS = 12;
export const YEARLY_CHARGED_MONTHS = 10;

// ---------------------------------------------------------------------------
// Credit lifetimes
// ---------------------------------------------------------------------------

/**
 * Whether unused monthly plan credits carry into the next month. Off: they
 * expire when the next month's credits arrive. On: they live for
 * ROLLOVER_EXPIRY_MONTHS after they were issued.
 */
export const PLAN_CREDITS_ROLL_OVER: boolean = false;
export const ROLLOVER_EXPIRY_MONTHS = 2;

/** Bought credits (top-ups, manual or automatic) and welcome credits last this long. */
export const TOPUP_CREDIT_EXPIRY_MONTHS = 12;

/** How many months a plan grant lives, given the rollover switch. */
export function planCreditExpiryMonths(): number {
  // This switch is edited by customize-pricing.
  return Boolean(PLAN_CREDITS_ROLL_OVER) ? ROLLOVER_EXPIRY_MONTHS : 1;
}

// ---------------------------------------------------------------------------
// Welcome credits
// ---------------------------------------------------------------------------

/**
 * Credits a new user gets once, on their first workspace, with no plan. Zero
 * means paid from the first message: nothing runs until they buy credits.
 * Deployments without billing never check a balance, so this only
 * applies when Stripe is configured. These credits cost the operator real money.
 */
export const WELCOME_CREDITS: number = 0;

// ---------------------------------------------------------------------------
// Auto top-up
// ---------------------------------------------------------------------------

export const AUTO_TOPUP = {
  /**
   * Balance at or below which an automatic top-up fires, until the customer
   * picks another value in Billing settings. Small enough to not buy early,
   * large enough that the refill lands before a chat stalls.
   */
  thresholdCredits: 20,
  /** The trigger balances a customer can pick from. Must include thresholdCredits. */
  thresholdChoices: [20, 50, 100, 200, 400],
  /** Credits an automatic top-up adds until the customer picks a package. */
  defaultCredits: 1_000,
  /** The highest monthly ceiling a customer may set for automatic top-ups. */
  maxMonthlyCapCents: 1_000_000,
  /** A declining card is left alone for this long before the next attempt. */
  failedCooldownHours: 24,
} as const;

// ---------------------------------------------------------------------------
// Vendor bills (nothing bills from this list; the admin page uses it)
// ---------------------------------------------------------------------------

/**
 * Three sizes an operator can picture. Every vendor bill below is estimated
 * at each one, so the page shows how the bills move as the product grows.
 */
export const COST_SCALES = [
  { key: 'starting', label: 'Starting out', customers: 10 },
  { key: 'growing', label: 'About 100 customers', customers: 100 },
  { key: 'busy', label: 'About 1,000 customers', customers: 1_000 },
] as const;

export type CostScale = (typeof COST_SCALES)[number]['key'];

/**
 * What one paying customer is assumed to do in a month, so the estimates
 * below can be read and questioned. Change these with the estimates.
 */
export const COST_ASSUMPTIONS = {
  messagesPerCustomer: 300,
  storedGigabytesPerCustomer: 0.5,
  emailsAndNotificationsPerCustomer: 30,
} as const;

export type VendorBill = {
  name: string;
  /** What it does for the product, in plain words. */
  role: string;
  /** What makes this bill grow, in plain words. */
  grows: string;
  /**
   * Estimated monthly bill in cents at each scale, on the plan the vendor
   * would put you on. Starting estimates read off the vendors' public pricing
   * pages; operators replace them with their real bills.
   */
  monthlyCents: Record<CostScale, number>;
  pricingUrl: string;
};

/**
 * Every service the product runs on is paid. Each has a free tier that covers
 * a small app and a bill that grows with use. Usage that customers cause
 * directly (model tokens, sandbox and browser hours, media, voice) is charged
 * to them in credits and is NOT in this list; these are the bills that arrive
 * on top of that.
 */
export const VENDOR_BILLS: readonly VendorBill[] = [
  {
    name: 'Vercel',
    role: 'Hosts the app',
    grows: 'The Pro plan is per seat; bandwidth and compute add up past its allowance',
    monthlyCents: { starting: 2_000, growing: 2_000, busy: 6_000 },
    pricingUrl: 'https://vercel.com/pricing',
  },
  {
    name: 'Neon',
    role: 'The database',
    grows: 'Compute hours and storage; the free tier covers a small app',
    monthlyCents: { starting: 0, growing: 2_500, busy: 9_000 },
    pricingUrl: 'https://neon.com/pricing',
  },
  {
    name: 'Vercel Blob',
    role: 'Stores uploads and generated files',
    grows: 'Usage-based storage and operations; delivery also incurs CDN and transfer costs',
    // Storage-only estimates at $0.023/GB-month for 5, 50 and 500 GB.
    monthlyCents: { starting: 12, growing: 115, busy: 1_150 },
    pricingUrl: 'https://vercel.com/docs/vercel-blob/usage-and-pricing',
  },
  {
    name: 'Browserbase',
    role: 'The browser your agents drive',
    grows: 'The plan tier; the browser hours themselves are charged to customers in credits',
    monthlyCents: { starting: 2_000, growing: 2_000, busy: 9_900 },
    pricingUrl: 'https://www.browserbase.com/pricing',
  },
  {
    name: 'Composio',
    role: 'Connects customer apps like Gmail and Notion',
    grows: 'Tool calls past the free 100,000 a month',
    monthlyCents: { starting: 0, growing: 0, busy: 5_900 },
    pricingUrl: 'https://composio.dev/pricing',
  },
  {
    name: 'Resend',
    role: 'Email',
    grows: 'Emails past 3,000 a month',
    monthlyCents: { starting: 0, growing: 2_000, busy: 2_000 },
    pricingUrl: 'https://resend.com/pricing',
  },
  {
    name: 'PostHog',
    role: 'Analytics',
    grows: 'Events past one million a month',
    monthlyCents: { starting: 0, growing: 0, busy: 8_400 },
    pricingUrl: 'https://posthog.com/pricing',
  },
];

// ---------------------------------------------------------------------------
// Derived money. Integer cents everywhere.
// ---------------------------------------------------------------------------

/**
 * What one block of credits costs a customer per month: the vendor cost of the
 * block divided by the share of the price that covers cost, rounded to a
 * whole cent. At 0% margin and 1 cent per credit, 100 credits cost $1.
 */
export function creditBlockPriceCents(): number {
  return Math.round((CREDIT_BLOCK * CENTS_PER_CREDIT * 100) / (100 - MARGIN_PERCENT));
}

/** Retail price of one credit in cents, as a fraction of the block price. */
export function creditPriceCents(): number {
  return creditBlockPriceCents() / CREDIT_BLOCK;
}

export function blocksForCredits(credits: number): number {
  if (!Number.isInteger(credits) || credits <= 0 || credits % CREDIT_BLOCK !== 0) {
    throw new BillingError(
      'VALIDATION_FAILED',
      `credits must be a positive multiple of ${CREDIT_BLOCK}`,
      { credits, creditBlock: CREDIT_BLOCK },
    );
  }
  return credits / CREDIT_BLOCK;
}

/** Calculation unit for pricing and prorated credit grants on this interval. */
export function blockUnitAmountCents(interval: BillingInterval): number {
  const monthly = creditBlockPriceCents();
  return interval === 'year' ? monthly * YEARLY_CHARGED_MONTHS : monthly;
}

/** What a plan subscription costs for `credits` a month, billed on `interval`. */
export function planAmountCents(credits: number, interval: BillingInterval): number {
  return blocksForCredits(credits) * blockUnitAmountCents(interval);
}

/** Effective monthly display for a yearly price, spread across all delivered months. */
export function effectiveYearlyMonthlyAmountCents(yearlyAmountCents: number): number {
  return Math.round(yearlyAmountCents / YEARLY_DELIVERED_MONTHS);
}

/** The price of exactly `credits`, with nothing rounded up to a block. */
export function wholeCreditsCents(credits: number): number {
  return Math.round((credits * creditBlockPriceCents()) / CREDIT_BLOCK);
}

/**
 * What a one-time top-up of `credits` costs. Same credit price as a plan. A
 * manual purchase can be any valid whole number; below the minimum only whole
 * blocks have a price, which covers auto top-up's packages.
 */
export function topupAmountCents(credits: number): number {
  if (!isTopupCredits(credits)) blocksForCredits(credits);
  return wholeCreditsCents(credits);
}

/**
 * Vendor cost of `credits` in cents. The other side of the margin: what those
 * credits cost the operator when fully used.
 */
export function creditsCostCents(credits: number): number {
  return credits * CENTS_PER_CREDIT;
}

export function expiresAtMonthsAfter(issuedAt: Date, months: number): Date {
  const targetMonthStart = new Date(
    Date.UTC(
      issuedAt.getUTCFullYear(),
      issuedAt.getUTCMonth() + months,
      1,
      issuedAt.getUTCHours(),
      issuedAt.getUTCMinutes(),
      issuedAt.getUTCSeconds(),
      issuedAt.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();
  targetMonthStart.setUTCDate(Math.min(issuedAt.getUTCDate(), lastDay));
  return targetMonthStart;
}

// Conservative preflight estimates, also used when Gateway usage cannot be read.
// Image estimates include input overhead; video includes sound. These are not quoted vendor rates.
export const MEDIA_ESTIMATE_CENTS = {
  'openai/gpt-image-1.5': { low: 5, mid: 15, high: 50 },
  'openai/gpt-image-2.6-flare': { low: 5, mid: 15, high: 50 },
  'bytedance/seedance-2.5': { perSecond: { low: 15.2, mid: 30.4, high: 68.2 } },
  'elevenlabs/eleven-v4': { perThousandCharacters: 30 },
  'elevenlabs/scribe-v2': { perHour: 40, preflightSeconds: 3600 },
} as const;

export function speechEstimateCents(characters: number): number {
  return (MEDIA_ESTIMATE_CENTS['elevenlabs/eleven-v4'].perThousandCharacters * characters) / 1000;
}

export function transcriptionEstimateCents(seconds: number): number {
  return (MEDIA_ESTIMATE_CENTS['elevenlabs/scribe-v2'].perHour * seconds) / 3600;
}
