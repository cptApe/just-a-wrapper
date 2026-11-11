import { CURRENCY } from '../catalog';
import type { IntendedPrice } from './stripe-plan';

type StripeCatalogField = 'currency' | 'amount' | 'product' | 'interval' | 'metadata';

export type StripeCatalogIssue = {
  lookupKey: string;
  field: StripeCatalogField | 'missing';
  expected: string;
  actual: string;
};

export type LiveCatalogPrice = {
  currency: string;
  unitAmountCents: number | null;
  productId: string;
  interval: string | undefined;
  metadata: Record<string, string>;
};

function formatPairs(pairs: [string, string][]): string {
  return pairs.map(([key, value]) => `${key}=${value}`).join(', ');
}

// Compare only keys the seed writes; extra Stripe metadata does not make the catalog stale.
function metadataMismatch(
  intended: IntendedPrice,
  live: Record<string, string>,
): { expected: string; actual: string } | null {
  const differing = Object.entries(intended.metadata).filter(([key, value]) => live[key] !== value);
  if (differing.length === 0) return null;
  return {
    expected: formatPairs(differing),
    actual: formatPairs(differing.map(([key]) => [key, live[key] ?? 'not set'])),
  };
}

// Plans on sale charge what pricing-config.ts derives, so a different amount means Stripe is stale.
// Existing subscribers keep the price they signed up at; a new seed moves only the lookup key.
export function diffIntendedPrice(
  intended: IntendedPrice,
  live: LiveCatalogPrice,
): StripeCatalogIssue[] {
  const issues: StripeCatalogIssue[] = [];
  const push = (field: StripeCatalogField, expected: string, actual: string) => {
    if (expected !== actual) {
      issues.push({ lookupKey: intended.lookupKey, field, expected, actual });
    }
  };
  push('currency', CURRENCY, live.currency);
  push(
    'amount',
    `${intended.unitAmountCents} cents`,
    live.unitAmountCents === null ? 'no unit amount' : `${live.unitAmountCents} cents`,
  );
  push('product', intended.productId, live.productId);
  push('interval', intended.interval, live.interval ?? 'one-time');
  const metadata = metadataMismatch(intended, live.metadata);
  if (metadata) issues.push({ lookupKey: intended.lookupKey, field: 'metadata', ...metadata });
  return issues;
}

export function missingPriceIssue(intended: IntendedPrice): StripeCatalogIssue {
  return {
    lookupKey: intended.lookupKey,
    field: 'missing',
    expected: 'an active price',
    actual: 'no active price',
  };
}
