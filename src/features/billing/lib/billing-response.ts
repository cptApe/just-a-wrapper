import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { BILLING_INTERVALS, PLAN_TIERS } from '../pricing-config';

export const topupChargeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('charged'), credits: z.number(), balance: z.number() }),
  z.object({ outcome: z.literal('processing') }),
  z.object({ outcome: z.literal('expired') }),
  z.object({ outcome: z.literal('already_charged') }),
  z.object({ outcome: z.literal('fallback'), url: z.url() }),
  z.object({
    outcome: z.literal('card_failed'),
    reason: z.enum(['declined', 'authentication_required']),
  }),
]);

export const topupOptionsSchema = z.object({
  workspaceId: z.string(),
  offersPlans: z.boolean(),
  // A default payment method that is not a card has no brand or number to show.
  savedCard: z.object({ brand: z.string().nullable(), last4: z.string().nullable() }).nullable(),
});

export const autoTopupSettingsSchema = z.object({
  enabled: z.boolean(),
  thresholdCredits: z.number(),
  topupCredits: z.number(),
  monthlyCapCents: z.number(),
});

const planChoiceShape = {
  tier: z.enum(PLAN_TIERS),
  interval: z.enum(BILLING_INTERVALS),
  credits: z.number().int().positive(),
};

export const planOptionsSchema = z.object({
  packs: z.array(
    z.object({
      ...planChoiceShape,
      priceId: z.string(),
      unitAmount: z.number().int().nonnegative(),
      currency: z.string(),
    }),
  ),
  current: z
    .object({
      tier: z.enum(PLAN_TIERS),
      interval: z.enum(BILLING_INTERVALS),
      credits: z.number().int().positive().nullable(),
      amountCents: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  renewsAt: z.iso.datetime().nullable(),
  cancelsAt: z.iso.datetime().nullable(),
  scheduled: z.object({ ...planChoiceShape, startsAt: z.iso.datetime() }).nullable(),
  pastDue: z.boolean(),
});

/** What the plan routes accept: one plan, interval and monthly package. */
export const planChoiceSchema = z.object(planChoiceShape);

export const planCheckoutSchema = z.object({ url: z.url() });
export const planChangeSchema = z.object({ effective: z.enum(['now', 'next_renewal']) });
export const planChangePreviewSchema = z.object({
  amountCents: z.number().int(),
  currency: z.string(),
  prorationDate: z.number().int(),
});
export const planCancelSchema = z.object({ cancelsAt: z.iso.datetime().nullable() });

export const stripeReconciliationSchema = z.object({
  purchase: z
    .object({ key: z.string(), credits: z.number(), workspaceId: z.string() })
    .nullable()
    .optional(),
  status: z.enum([
    'applied',
    'unchanged',
    'pending',
    'no_customer',
    'no_subscription',
    'no_invoice',
  ]),
});

export function parseBillingResponse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      'API_REQUEST_FAILED',
      'Billing returned an invalid response',
      {},
      { cause: parsed.error },
    );
  }
  return parsed.data;
}
