import { existsSync } from 'node:fs';
import path from 'node:path';
import type { codeIdentity } from '../content/brand.ts';
import type { AgentTier, AgentTierConfig } from '../src/features/agents/types.ts';
import type { PresetSkill } from '../src/features/skills/constants.ts';
import { unsetBrandValues } from '../src/lib/brand/requirements.ts';
import type { ToolkitGroupId, ToolkitMeta, ToolkitSlug } from '../src/lib/composio/toolkits.ts';
import type { DeploymentSettingKey } from '../src/lib/deployment-settings/registry.ts';
import { requiredConfigEnvSchema } from '../src/lib/env-schema.ts';

/**
 * The commercial values `pricing-config.ts` owns, in the shape this validator
 * needs them. Passed in rather than imported so a test can exercise a broken
 * fork's numbers without editing the real configuration.
 */
type PricingConfigurationInput = {
  /** Plans are sold (subscription mode); only then is the plan catalog checked. */
  sellsPlans: boolean;
  marginPercent: number;
  creditBlock: number;
  creditPackages: readonly number[];
  starterPackCredits: number;
  plans: Readonly<Record<string, { name: string; minCredits: number }>>;
  welcomeCredits: number;
  autoTopupDefaultCredits: number;
  autoTopupThresholdCredits: number;
  autoTopupThresholdChoices: readonly number[];
  costScales: readonly { key: string; label: string; customers: number }[];
  vendorBills: readonly { name: string; monthlyCents: Readonly<Record<string, number>> }[];
};

export type ConfigurationInput = {
  code: Pick<typeof codeIdentity, 'slug'>;
  /** Settings an admin stored in the console; they count as set. */
  storedSettings: ReadonlySet<DeploymentSettingKey>;
  skills: readonly PresetSkill[];
  toolkitSlugs: readonly ToolkitSlug[];
  toolkits: Readonly<Record<ToolkitSlug, ToolkitMeta>>;
  toolkitGroupIds: readonly ToolkitGroupId[];
  tiers: Readonly<Record<AgentTier, AgentTierConfig>>;
  pricing: PricingConfigurationInput;
  environment: NodeJS.ProcessEnv;
};

export function slugifyConfigName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * The pricing invariants the rest of the kit assumes. Every one of these is a
 * wrong-money bug if it breaks: package totals require whole pricing increments, and a
 * margin outside 0..95 either sells credits below cost or divides by zero.
 */
function pricingErrors(pricing: PricingConfigurationInput): string[] {
  const errors: string[] = [];
  const file = 'src/features/billing/pricing-config.ts';

  if (!Number.isInteger(pricing.marginPercent) || pricing.marginPercent < 0) {
    errors.push(
      `MARGIN_PERCENT is ${pricing.marginPercent}. Set a whole number from 0 to 95 in ${file}.`,
    );
  } else if (pricing.marginPercent > 95) {
    errors.push(
      `MARGIN_PERCENT is ${pricing.marginPercent}, which prices a credit more than twenty times its cost. Set a whole number from 0 to 95 in ${file}.`,
    );
  }

  if (!Number.isInteger(pricing.creditBlock) || pricing.creditBlock <= 0) {
    errors.push(
      `CREDIT_BLOCK is ${pricing.creditBlock}. Set a whole number above zero in ${file}; every credit package is a multiple of it.`,
    );
    return errors;
  }

  const isBlockMultiple = (credits: number) =>
    Number.isInteger(credits) && credits > 0 && credits % pricing.creditBlock === 0;

  for (const credits of pricing.creditPackages) {
    if (!isBlockMultiple(credits)) {
      errors.push(
        `CREDIT_PACKAGES contains ${credits}, which is not a positive multiple of CREDIT_BLOCK (${pricing.creditBlock}). Fix it in ${file}.`,
      );
    }
  }

  for (const [index, credits] of pricing.creditPackages.entries()) {
    const previous = pricing.creditPackages[index - 1];
    if (previous !== undefined && credits <= previous) {
      errors.push(
        `CREDIT_PACKAGES goes from ${pricing.creditPackages[index - 1]} to ${pricing.creditPackages[index]}. List every package once, smallest first, in ${file}.`,
      );
      break;
    }
  }

  const smallestPackage = pricing.creditPackages[0] ?? Number.POSITIVE_INFINITY;
  if (
    !Number.isInteger(pricing.starterPackCredits) ||
    pricing.starterPackCredits <= 0 ||
    pricing.starterPackCredits >= smallestPackage
  ) {
    errors.push(
      `STARTER_PACK_CREDITS is ${pricing.starterPackCredits}. Set a whole number above zero and below the first entry in CREDIT_PACKAGES in ${file}.`,
    );
  }

  for (const [key, plan] of pricing.sellsPlans ? Object.entries(pricing.plans) : []) {
    if (!isBlockMultiple(plan.minCredits)) {
      errors.push(
        `Plan "${key}" starts at ${plan.minCredits} credits, which is not a positive multiple of CREDIT_BLOCK (${pricing.creditBlock}). Fix it in ${file}.`,
      );
    }
    if (!pricing.creditPackages.some((credits) => credits >= plan.minCredits)) {
      errors.push(
        `Plan "${key}" starts at ${plan.minCredits} credits and no package in CREDIT_PACKAGES is that big, so nobody can buy it. Add one in ${file}.`,
      );
    }
  }

  if (!Number.isInteger(pricing.welcomeCredits) || pricing.welcomeCredits < 0) {
    errors.push(
      `WELCOME_CREDITS is ${pricing.welcomeCredits}. Set a whole number of zero or more in ${file}.`,
    );
  }

  if (!pricing.autoTopupThresholdChoices.includes(pricing.autoTopupThresholdCredits)) {
    errors.push(
      `AUTO_TOPUP.thresholdCredits is ${pricing.autoTopupThresholdCredits}, which is not one of AUTO_TOPUP.thresholdChoices. Pick one of them in ${file}.`,
    );
  }
  if (!pricing.creditPackages.includes(pricing.autoTopupDefaultCredits)) {
    errors.push(
      `AUTO_TOPUP.defaultCredits is ${pricing.autoTopupDefaultCredits}, which is not one of the packages in CREDIT_PACKAGES. Pick one of them in ${file}.`,
    );
  }

  for (const [index, scale] of pricing.costScales.entries()) {
    const previous = pricing.costScales[index - 1];
    if (previous !== undefined && scale.customers <= previous.customers) {
      errors.push(
        `COST_SCALES goes from ${previous.customers} customers to ${scale.customers}. List every scale once, smallest first, in ${file}.`,
      );
      break;
    }
  }

  for (const bill of pricing.vendorBills) {
    for (const scale of pricing.costScales) {
      const cents = bill.monthlyCents[scale.key];
      if (cents === undefined || !Number.isInteger(cents) || cents < 0) {
        errors.push(
          `VENDOR_BILLS entry "${bill.name}" costs ${cents} cents a month at "${scale.key}". Set a whole number of cents, zero or more, in ${file}.`,
        );
      }
    }
  }

  return errors;
}

export function configurationErrors(config: ConfigurationInput): string[] {
  const errors: string[] = [];

  if (config.code.slug.trim().length === 0) {
    errors.push('The code slug is empty. Set codeIdentity.slug in content/brand.ts.');
  }
  errors.push(...unsetBrandValues(config.environment, config.storedSettings));

  for (const skill of config.skills) {
    const expected = slugifyConfigName(skill.name);
    if (skill.directory !== expected) {
      errors.push(
        `Skill "${skill.name}" uses directory "${skill.directory}". Rename it to the slug "${expected}"; this re-provisions the skill upstream under the new directory, as intended after a rebrand.`,
      );
    }
    if (!existsSync(path.resolve(process.cwd(), skill.contentDir))) {
      errors.push(
        `Skill "${skill.name}" uses missing content directory "${skill.contentDir}". Add it before provisioning presets.`,
      );
    }
  }

  const uniqueSlugs = new Set(config.toolkitSlugs);
  if (uniqueSlugs.size !== config.toolkitSlugs.length) {
    errors.push(
      'Connected app slugs contain a duplicate. Remove it from src/lib/composio/toolkits.ts.',
    );
  }
  for (const slug of config.toolkitSlugs) {
    const toolkit = config.toolkits[slug];
    if (!toolkit) {
      errors.push(`Connected app "${slug}" has no metadata in src/lib/composio/toolkits.ts.`);
      continue;
    }
    if (toolkit.slug !== slug) {
      errors.push(`Connected app "${slug}" has mismatched metadata slug "${toolkit.slug}".`);
    }
    if (!config.toolkitGroupIds.includes(toolkit.group)) {
      errors.push(`Connected app "${slug}" uses unknown group "${toolkit.group}".`);
    }
  }

  const requiredTiers: readonly AgentTier[] = ['fast', 'default', 'pro'];
  for (const tierName of requiredTiers) {
    const tier = config.tiers[tierName];
    if (!tier) {
      errors.push(`Agent tier "${tierName}" is missing from agents/config.ts.`);
    } else if (tier.tier !== tierName) {
      errors.push(`Agent tier "${tierName}" declares tier "${tier.tier}".`);
    }
  }

  errors.push(...pricingErrors(config.pricing));
  if (config.environment.STRIPE_SECRET_KEY && !config.environment.CRON_SECRET?.trim()) {
    errors.push('CRON_SECRET is required when Stripe is enabled so billing recovery can run.');
  }

  const environment = requiredConfigEnvSchema.safeParse(config.environment);
  if (!environment.success) {
    for (const issue of environment.error.issues) {
      const key = issue.path.join('.');
      errors.push(`${key} is missing or invalid. Add a valid value to .env.`);
    }
  }

  return errors;
}
