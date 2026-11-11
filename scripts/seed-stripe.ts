// Idempotent Stripe catalog seeding. Test mode by default; `--live` is the only
// way to run it against a live key. All commercial values are read from
// pricing-config.ts; this script only materializes them as Stripe objects.
// Products use deterministic ids. Prices use unique lookup keys and immutable
// replacement, transferring the key before deactivating a stale price.
//
// One recurring price per plan, interval and credit package, quantity one.
// Top-ups use inline prices; obsolete catalog prices are archived after seeding.
// Plans are seeded only in subscription mode. In credits-only mode the script ensures the top-up
// product and leaves every plan price alone, because existing subscribers still pay on them.
//
// The Stripe API version is pinned deliberately: SDK response shapes must not
// move underneath this script.
import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { CURRENCY, PLAN_PRODUCT_IDS, TOPUP_PRODUCT_ID } from '../src/features/billing/catalog.ts';
import { billingModeRules } from '../src/features/billing/lib/billing-mode-rules.ts';
import {
  buildIntendedCatalog,
  type IntendedPrice,
} from '../src/features/billing/lib/stripe-plan.ts';
import {
  PLAN_TIERS,
  PLANS,
  packagesForPlan,
  planAmountCents,
} from '../src/features/billing/pricing-config.ts';
import { brand } from '../src/lib/brand/identity.ts';
import { billingModeForScript, describeBillingMode } from './billing-mode.ts';

const API_VERSION = '2026-05-27.dahlia';

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Prints the SAME `buildIntendedCatalog()` list `main()` then materializes —
// one list, passed in, so the dry run can never describe a catalog the apply
// step would not create.
function printPlan(intended: IntendedPrice[], mode: 'TEST' | 'LIVE'): void {
  console.log(`\nStripe catalog plan (${mode} MODE):\n`);
  for (const price of intended) {
    const unit = `${dollars(price.unitAmountCents)} per ${price.credits} credits`;
    const shape = `recurring, per ${price.interval}`;
    console.log(`  - ${price.lookupKey}: ${unit} (${shape})`);
  }

  console.log('\nWhat that sells, by plan:\n');
  for (const tier of PLAN_TIERS) {
    console.log(`${PLANS[tier].name}:`);
    for (const credits of packagesForPlan(tier)) {
      const monthly = dollars(planAmountCents(credits, 'month'));
      const yearly = dollars(planAmountCents(credits, 'year'));
      console.log(
        `  - ${credits.toLocaleString('en-US')} credits a month: ${monthly} monthly, ${yearly} yearly`,
      );
    }
    console.log('');
  }
}

async function ensureProduct(
  stripe: Stripe,
  id: string,
  params: Stripe.ProductCreateParams,
): Promise<{ id: string; created: boolean }> {
  try {
    const existing = await stripe.products.retrieve(id);
    // The product id is stable across brand renames; the customer-facing name
    // follows NEXT_PUBLIC_BRAND_NAME, so a rename shows up on the next seed run.
    if (params.name && existing.name !== params.name) {
      await stripe.products.update(id, { name: params.name });
    }
    // A product seeded without a description clears any text an older seed left on Stripe's hosted page.
    if (params.description === undefined && existing.description) {
      await stripe.products.update(id, { description: '' });
    }
    return { id: existing.id, created: false };
  } catch (cause) {
    if (
      cause instanceof Stripe.errors.StripeInvalidRequestError &&
      cause.code === 'resource_missing'
    ) {
      const created = await stripe.products.create({ ...params, id });
      return { id: created.id, created: true };
    }
    // Only a missing deterministic product enters the create path. Every other
    // Stripe failure is rethrown so authentication/network faults stay visible.
    throw cause;
  }
}

export async function ensurePrice(
  stripe: Stripe,
  lookupKey: string,
  params: Omit<Stripe.PriceCreateParams, 'lookup_key'>,
): Promise<{ id: string; created: boolean }> {
  // Lookup keys are the stable catalog identity across seed runs; Stripe prices
  // are immutable, so a changed price transfers that identity to its replacement.
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  const existing = found.data[0];
  const expectedProduct = params.product;
  const existingProduct =
    typeof existing?.product === 'string' ? existing.product : existing?.product?.id;
  const metadataMatches = Object.entries(params.metadata ?? {}).every(
    ([key, value]) => existing?.metadata[key] === value,
  );
  if (
    existing &&
    existing.active &&
    existing.currency === params.currency &&
    existing.unit_amount === params.unit_amount &&
    existingProduct === expectedProduct &&
    existing.recurring?.interval === params.recurring?.interval &&
    metadataMatches
  ) {
    if (existing.nickname !== params.nickname) {
      await stripe.prices.update(existing.id, { nickname: params.nickname });
    }
    return { id: existing.id, created: false };
  }
  const created = await stripe.prices.create({
    ...params,
    lookup_key: lookupKey,
    transfer_lookup_key: Boolean(existing),
  });
  if (existing) await stripe.prices.update(existing.id, { active: false });
  return { id: created.id, created: true };
}

function priceParams(price: IntendedPrice): Omit<Stripe.PriceCreateParams, 'lookup_key'> {
  return {
    product: price.productId,
    currency: CURRENCY,
    unit_amount: price.unitAmountCents,
    nickname: price.nickname,
    metadata: price.metadata,
    recurring: { interval: price.interval },
  };
}

export async function obsoletePrices(
  stripe: Stripe,
  intended: readonly IntendedPrice[],
): Promise<Stripe.Price[]> {
  const keys = new Set(intended.map((price) => price.lookupKey));
  const obsolete: Stripe.Price[] = [];
  // This runs before the products are created, and Stripe rejects a price list
  // for a missing product. The `ids` filter returns only the products that
  // exist. Stripe allows no cursor with `ids`, so this reads the single page.
  const products = await stripe.products.list({
    ids: [...Object.values(PLAN_PRODUCT_IDS), TOPUP_PRODUCT_ID],
    limit: 100,
  });
  for (const product of products.data) {
    for await (const price of stripe.prices.list({
      product: product.id,
      active: true,
      limit: 100,
    })) {
      if (!price.lookup_key || !keys.has(price.lookup_key)) obsolete.push(price);
    }
  }
  return obsolete;
}

async function main(): Promise<void> {
  const billing = await billingModeForScript();
  const sellsPlans = billingModeRules(billing.mode).sellsPlans;
  console.log(describeBillingMode(billing));
  if (!sellsPlans) console.log('Plans are not sold, so no plan price is created or archived.');
  // The one derivation. Both the dry run and the apply step below read this
  // exact list, in this exact order, so neither can drift from the other.
  const intended = sellsPlans ? buildIntendedCatalog() : [];

  const live = process.argv.includes('--live');
  // The live key can sit beside the test key as STRIPE_SECRET_KEY_LIVE, so a
  // live seed never needs the app's own STRIPE_SECRET_KEY swapped first.
  const key = live
    ? (process.env.STRIPE_SECRET_KEY_LIVE ?? process.env.STRIPE_SECRET_KEY)
    : process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.log('STRIPE_SECRET_KEY not set; dry run with no Stripe calls.');
    if (sellsPlans) printPlan(intended, live ? 'LIVE' : 'TEST');
    return;
  }
  // A live key writes to the real catalog that customers pay against, so it
  // needs the explicit flag; a test key with the flag is a mismatch too.
  if (live && !key.startsWith('sk_live_')) {
    console.error('Refusing to run: --live needs a live-mode STRIPE_SECRET_KEY (sk_live_...).');
    process.exit(1);
  }
  if (!live && !key.startsWith('sk_test_')) {
    console.error(
      'Refusing to run: STRIPE_SECRET_KEY must be a test-mode key. Pass --live to seed a live catalog on purpose.',
    );
    process.exit(1);
  }
  // Product names follow the brand name, so a live seed without it would rename the real catalog
  // to the placeholder customers then see on receipts.
  if (live && !process.env.NEXT_PUBLIC_BRAND_NAME?.trim()) {
    console.error(
      `Refusing to run: set NEXT_PUBLIC_BRAND_NAME first. Without it the live products are named "${brand.name}".`,
    );
    process.exit(1);
  }

  const stripe = new Stripe(key, { apiVersion: API_VERSION, typescript: true });
  if (sellsPlans) printPlan(intended, live ? 'LIVE' : 'TEST');
  const obsolete = sellsPlans ? await obsoletePrices(stripe, intended) : [];
  console.log('\nPrices to archive:');
  for (const price of obsolete)
    console.log(`  - ${price.id} (${price.lookup_key ?? 'no lookup key'})`);
  if (obsolete.length === 0) console.log('  None');
  if (process.argv.includes('--dry-run')) return;
  console.log('\nApplying catalog...\n');

  for (const tier of sellsPlans ? PLAN_TIERS : []) {
    const product = await ensureProduct(stripe, PLAN_PRODUCT_IDS[tier], {
      name: `${brand.name} ${PLANS[tier].name}`,
      description: PLANS[tier].description,
      metadata: { just_a_wrapper_kind: 'plan', tier },
    });
    console.log(`product ${product.id} (${product.created ? 'created' : 'found'})`);
  }

  const topupProduct = await ensureProduct(stripe, TOPUP_PRODUCT_ID, {
    name: `${brand.name} credits`,
    metadata: { just_a_wrapper_kind: 'topup' },
  });
  console.log(`product ${topupProduct.id} (${topupProduct.created ? 'created' : 'found'})`);

  for (const intendedPrice of intended) {
    const price = await ensurePrice(stripe, intendedPrice.lookupKey, priceParams(intendedPrice));
    console.log(
      `  price ${price.id} (${intendedPrice.lookupKey}, ${price.created ? 'created' : 'found'})`,
    );
  }
  for (const price of obsolete) {
    await stripe.prices.update(price.id, { active: false });
    console.log(`  archived ${price.id} (${price.lookup_key ?? 'no lookup key'})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    // CLI boundary: preserve the original stack and a non-zero exit code. This is
    // a manual command, so failures must never be captured and swallowed.
    process.exitCode = 1;
    throw error;
  });
