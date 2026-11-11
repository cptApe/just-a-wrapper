import Stripe from 'stripe';
import { codeIdentity } from '../content/brand.ts';
import { AGENT_TIERS } from '../src/features/agents/config.ts';
import { stripeWebhookConfigurationErrors } from '../src/features/billing/api/stripe-webhook-configuration.ts';
import { billingModeRules } from '../src/features/billing/lib/billing-mode-rules.ts';
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
} from '../src/features/billing/pricing-config.ts';
import { PRESET_SKILLS } from '../src/features/skills/constants.ts';
import {
  COMPOSIO_TOOLKIT_ALLOWLIST,
  TOOLKIT_GROUPS,
  TOOLKIT_METADATA,
} from '../src/lib/composio/toolkits.ts';
import { describeBillingMode } from './billing-mode.ts';
import { configurationErrors } from './config-validation.ts';
import { deploymentSettingsForScript } from './deployment-settings.ts';

const SETTING_KEYS = ['billingMode', 'supportEmail'] as const;
const settings = await deploymentSettingsForScript(SETTING_KEYS);
const billing = { mode: settings.billingMode.value, source: settings.billingMode.source };
console.log(describeBillingMode(billing));

const errors = configurationErrors({
  code: codeIdentity,
  storedSettings: new Set(SETTING_KEYS.filter((key) => settings[key].source === 'stored')),
  skills: PRESET_SKILLS,
  toolkitSlugs: COMPOSIO_TOOLKIT_ALLOWLIST,
  toolkits: TOOLKIT_METADATA,
  toolkitGroupIds: TOOLKIT_GROUPS.map((group) => group.id),
  tiers: AGENT_TIERS,
  pricing: {
    sellsPlans: billingModeRules(billing.mode).sellsPlans,
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
  },
  environment: process.env,
});

if (process.env.STRIPE_SECRET_KEY && process.env.NEXT_PUBLIC_APP_URL) {
  errors.push(
    ...(await stripeWebhookConfigurationErrors(
      new Stripe(process.env.STRIPE_SECRET_KEY),
      process.env.NEXT_PUBLIC_APP_URL,
    )),
  );
}

if (errors.length > 0) {
  console.error('Configuration needs attention:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    'Configuration is valid. Brand, contact details, skills, connected apps, tiers, pricing, and required environment values are ready.',
  );
}
