// `pnpm validate:config` refuses a fork configuration that would ship a wrong price, an unbuyable
// plan, a missing skill or the placeholder brand, and tells the owner which value to fix.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeIdentity } from '../../content/brand.ts';
import { configurationErrors, slugifyConfigName } from '../../scripts/config-validation.ts';
import { AGENT_TIERS } from '../../src/features/agents/config.ts';
import {
  AUTO_TOPUP,
  COST_SCALES,
  CREDIT_BLOCK,
  CREDIT_PACKAGES,
  MARGIN_PERCENT,
  PLANS,
  STARTER_PACK_CREDITS,
  VENDOR_BILLS,
  WELCOME_CREDITS,
} from '../../src/features/billing/pricing-config.ts';
import { APP_GUIDE_SKILL_NAME, PRESET_SKILLS } from '../../src/features/skills/constants.ts';
import {
  COMPOSIO_TOOLKIT_ALLOWLIST,
  TOOLKIT_GROUPS,
  TOOLKIT_METADATA,
} from '../../src/lib/composio/toolkits.ts';

const environment = {
  DATABASE_URL: 'postgres://localhost/just-a-wrapper',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_BRAND_NAME: 'Acme',
  SUPPORT_EMAIL: 'help@acme.example',
};
const pricing = {
  sellsPlans: true,
  marginPercent: MARGIN_PERCENT,
  creditBlock: CREDIT_BLOCK,
  creditPackages: CREDIT_PACKAGES,
  starterPackCredits: STARTER_PACK_CREDITS,
  plans: PLANS,
  welcomeCredits: WELCOME_CREDITS,
  autoTopupDefaultCredits: AUTO_TOPUP.defaultCredits,
  autoTopupThresholdCredits: AUTO_TOPUP.thresholdCredits,
  autoTopupThresholdChoices: AUTO_TOPUP.thresholdChoices,
  costScales: COST_SCALES,
  vendorBills: VENDOR_BILLS,
};

function errorsWith({ pricing: pricingOverrides = {}, ...overrides } = {}) {
  return configurationErrors({
    code: codeIdentity,
    storedSettings: new Set(),
    skills: PRESET_SKILLS,
    toolkitSlugs: COMPOSIO_TOOLKIT_ALLOWLIST,
    toolkits: TOOLKIT_METADATA,
    toolkitGroupIds: TOOLKIT_GROUPS.map((group) => group.id),
    tiers: AGENT_TIERS,
    pricing: { ...pricing, ...pricingOverrides },
    environment,
    ...overrides,
  });
}

const FIX = 'in src/features/billing/pricing-config.ts';

test('the shipped configuration passes its own validator', () => {
  assert.deepEqual(errorsWith(), []);
  assert.deepEqual(errorsWith({ pricing: { marginPercent: 0, starterPackCredits: 250 } }), []);
  // Credits-only mode does not check the plan catalog it does not sell.
  assert.deepEqual(
    errorsWith({ pricing: { sellsPlans: false, creditPackages: [1000, 1500] } }),
    [],
  );
});

test('pricing that would charge the wrong amount or sell an unbuyable plan is refused, naming the fix', () => {
  for (const [overrides, error] of [
    [{ marginPercent: -1 }, `MARGIN_PERCENT is -1. Set a whole number from 0 to 95 ${FIX}.`],
    [
      { marginPercent: 96 },
      `MARGIN_PERCENT is 96, which prices a credit more than twenty times its cost. Set a whole number from 0 to 95 ${FIX}.`,
    ],
    [{ marginPercent: 80.5 }, `MARGIN_PERCENT is 80.5. Set a whole number from 0 to 95 ${FIX}.`],
    [
      { creditPackages: [1000, 1050, 1500, 5000] },
      `CREDIT_PACKAGES contains 1050, which is not a positive multiple of CREDIT_BLOCK (100). Fix it ${FIX}.`,
    ],
    [
      { creditPackages: [1500, 1000, 5000] },
      `CREDIT_PACKAGES goes from 1500 to 1000. List every package once, smallest first, ${FIX}.`,
    ],
    [
      { creditPackages: [1000, 1500] },
      `Plan "max" starts at 5000 credits and no package in CREDIT_PACKAGES is that big, so nobody can buy it. Add one ${FIX}.`,
    ],
    [
      { starterPackCredits: CREDIT_PACKAGES[0] },
      `STARTER_PACK_CREDITS is ${CREDIT_PACKAGES[0]}. Set a whole number above zero and below the first entry in CREDIT_PACKAGES ${FIX}.`,
    ],
    [{ welcomeCredits: -1 }, `WELCOME_CREDITS is -1. Set a whole number of zero or more ${FIX}.`],
    [
      { autoTopupDefaultCredits: 250 },
      `AUTO_TOPUP.defaultCredits is 250, which is not one of the packages in CREDIT_PACKAGES. Pick one of them ${FIX}.`,
    ],
    [
      { vendorBills: [{ name: 'Vercel', monthlyCents: { starting: -100, growing: 1, busy: 2 } }] },
      `VENDOR_BILLS entry "Vercel" costs -100 cents a month at "starting". Set a whole number of cents, zero or more, ${FIX}.`,
    ],
    // A broken block stops validation instead of cascading into every package.
    [
      { creditBlock: 0 },
      `CREDIT_BLOCK is 0. Set a whole number above zero ${FIX}; every credit package is a multiple of it.`,
    ],
  ]) {
    assert.deepEqual(errorsWith({ pricing: overrides }), [error], JSON.stringify(overrides));
  }
});

test('a deployment on the placeholder brand fails validation, naming each value', () => {
  const placeholders = { ...environment };
  delete placeholders.NEXT_PUBLIC_BRAND_NAME;
  delete placeholders.SUPPORT_EMAIL;
  assert.deepEqual(errorsWith({ environment: placeholders }), [
    'NEXT_PUBLIC_BRAND_NAME is not set, so the app is called "Just a Wrapper". Set it to your product name.',
    'Support email is not set, so the app shows "support@example.com". Set SUPPORT_EMAIL, or set it in the admin console where the console runs.',
  ]);
  // A support email stored in the admin console counts as set.
  assert.deepEqual(
    errorsWith({
      environment: { ...placeholders, NEXT_PUBLIC_BRAND_NAME: 'Acme' },
      storedSettings: new Set(['supportEmail']),
    }),
    [],
  );
});

test('Stripe without the recovery cron secret is refused, because unpaid recovery would never run', () => {
  const withStripe = { ...environment, STRIPE_SECRET_KEY: 'sk_test_fixture' };
  assert.ok(errorsWith({ environment: withStripe }).some((error) => error.includes('CRON_SECRET')));
  assert.deepEqual(errorsWith({ environment: { ...withStripe, CRON_SECRET: 'fixture' } }), []);
});

test('a preset skill with a missing folder or an old directory name is refused before provisioning', () => {
  const slug = slugifyConfigName(APP_GUIDE_SKILL_NAME);
  assert.deepEqual(
    errorsWith({
      skills: [{ ...PRESET_SKILLS[0], directory: slug, contentDir: 'content/missing-fixture' }],
    }),
    [
      `Skill "${APP_GUIDE_SKILL_NAME}" uses missing content directory "content/missing-fixture". Add it before provisioning presets.`,
    ],
  );
  assert.deepEqual(
    errorsWith({ skills: [{ ...PRESET_SKILLS[0], directory: 'old-brand-app-guide' }] }),
    [
      `Skill "${APP_GUIDE_SKILL_NAME}" uses directory "old-brand-app-guide". Rename it to the slug "${slug}"; this re-provisions the skill upstream under the new directory, as intended after a rebrand.`,
    ],
  );
});
