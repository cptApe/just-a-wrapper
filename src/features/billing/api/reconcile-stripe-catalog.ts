// The admin panel renders an explicit unavailable state when Stripe cannot be read.

import { cache } from 'react';
import { captureException } from '@/lib/observability';
import { getStripe } from '@/lib/stripe';
import { billingTerms } from './plan-limits';
import 'server-only';
import type Stripe from 'stripe';
import {
  diffIntendedPrice,
  missingPriceIssue,
  type StripeCatalogIssue,
} from '../lib/stripe-catalog-diff';
import { buildIntendedCatalog } from '../lib/stripe-plan';

// Stripe accepts at most ten lookup keys per prices request.
const LOOKUP_KEYS_PER_REQUEST = 10;

// Never render raw Stripe errors here: authentication failures may quote the rejected key.
export type StripeCatalogReconciliation =
  | { status: 'not-configured' }
  // Credits-only mode sells no plans, so their prices are not checked.
  | { status: 'plans-not-sold' }
  | { status: 'unavailable' }
  | { status: 'not-seeded'; intendedCount: number }
  | { status: 'in-sync'; intendedCount: number }
  | { status: 'differs'; intendedCount: number; issues: StripeCatalogIssue[] };

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export const reconcileStripeCatalog = cache(async (): Promise<StripeCatalogReconciliation> => {
  const stripe = getStripe();
  const intended = buildIntendedCatalog();
  if (!stripe) return { status: 'not-configured' };
  const terms = await billingTerms();
  if (terms.kind === 'stripe' && !terms.rules.sellsPlans) return { status: 'plans-not-sold' };

  let livePrices: Stripe.Price[];
  try {
    const pages = await Promise.all(
      chunk(
        intended.map((price) => price.lookupKey),
        LOOKUP_KEYS_PER_REQUEST,
      ).map((lookupKeys) =>
        stripe.prices.list({
          lookup_keys: lookupKeys,
          active: true,
          limit: LOOKUP_KEYS_PER_REQUEST,
        }),
      ),
    );
    livePrices = pages.flatMap((page) => page.data);
  } catch (cause) {
    captureException(cause, { op: 'billing.reconcile-stripe-catalog' });
    return { status: 'unavailable' };
  }

  const byLookupKey = new Map<string, Stripe.Price>(
    livePrices.flatMap((price) => (price.lookup_key ? [[price.lookup_key, price] as const] : [])),
  );

  if (byLookupKey.size === 0) return { status: 'not-seeded', intendedCount: intended.length };

  const issues: StripeCatalogIssue[] = [];
  for (const price of intended) {
    const live = byLookupKey.get(price.lookupKey);
    if (!live) {
      issues.push(missingPriceIssue(price));
      continue;
    }
    issues.push(
      ...diffIntendedPrice(price, {
        currency: live.currency,
        unitAmountCents: live.unit_amount,
        productId: typeof live.product === 'string' ? live.product : live.product.id,
        interval: live.recurring?.interval,
        metadata: live.metadata,
      }),
    );
  }

  return issues.length === 0
    ? { status: 'in-sync', intendedCount: intended.length }
    : { status: 'differs', intendedCount: intended.length, issues };
});
