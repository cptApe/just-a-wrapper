import { brandPlaceholders } from '@content/brand';
import { z } from 'zod';
import { AppError } from '../errors';

// Every setting an admin can change in the app, in one table. Each has an environment variable
// that gives its base value, so a deployment without the admin console sets it through env.
// Adding a setting is one entry here, its env key in src/lib/env.ts and a row in the admin env
// registry. A setting with a fixed list of values reuses DeploymentSettingChoice in the admin
// console; a free-text one reuses DeploymentSettingText.

/** How a deployment with Stripe sells: monthly plans, or one-time credits only. */
export const BILLING_MODES = ['subscriptions', 'credits_only'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

type Definition<T> = {
  /** The environment variable that sets the base value. */
  envKey: string;
  schema: z.ZodType<T>;
  /** The value with neither a stored setting nor the env var. */
  fallback: T;
  /**
   * The fallback is a placeholder that only local development and tests may run on. A real
   * deployment must set the value, and pnpm validate:config and a production build say so.
   */
  required: boolean;
  label: string;
  description: string;
};

function define<T>(definition: Definition<T>): Definition<T> {
  return definition;
}

export const DEPLOYMENT_SETTINGS = {
  billingMode: define<BillingMode>({
    envKey: 'BILLING_MODE',
    schema: z.enum(BILLING_MODES),
    fallback: 'subscriptions',
    required: false,
    label: 'Billing mode',
    description:
      'Subscriptions sell monthly plans with credits each cycle. Credits only sells one-time credits and no plans.',
  }),
  supportEmail: define<string>({
    envKey: 'SUPPORT_EMAIL',
    schema: z.string().trim().pipe(z.email()),
    fallback: brandPlaceholders.supportEmail,
    required: true,
    label: 'Support email',
    description:
      'Where people write for help and about their data: the Get help link, the footer of every email, and the terms and privacy pages.',
  }),
} as const;

export type DeploymentSettingKey = keyof typeof DEPLOYMENT_SETTINGS;
type DeploymentSettingValue<K extends DeploymentSettingKey> =
  (typeof DEPLOYMENT_SETTINGS)[K] extends Definition<infer T> ? T : never;

export function isDeploymentSettingKey(value: string): value is DeploymentSettingKey {
  return Object.hasOwn(DEPLOYMENT_SETTINGS, value);
}

export type SettingSource = 'stored' | 'env' | 'fallback';

export type ResolvedSetting<K extends DeploymentSettingKey> = {
  value: DeploymentSettingValue<K>;
  source: SettingSource;
};

/**
 * The one precedence rule: a valid stored value, then a valid env value, then the fallback.
 * An invalid env value throws, because it is a deployment mistake the operator must see.
 * An invalid stored value (a mode a fork removed) is reported by the caller and skipped.
 */
export function resolveDeploymentSetting<K extends DeploymentSettingKey>(
  key: K,
  input: { stored: unknown; envValue: string | undefined },
): ResolvedSetting<K> & { invalidStored: boolean } {
  const definition = DEPLOYMENT_SETTINGS[key] as unknown as Definition<DeploymentSettingValue<K>>;
  const stored =
    input.stored === null || input.stored === undefined
      ? null
      : definition.schema.safeParse(input.stored);
  if (stored?.success) return { value: stored.data, source: 'stored', invalidStored: false };
  const invalidStored = stored !== null;
  const raw = input.envValue?.trim();
  if (raw) {
    const parsed = definition.schema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${definition.envKey} is "${raw}", which is not a valid ${definition.label.toLowerCase()}.`,
        { envKey: definition.envKey },
      );
    }
    return { value: parsed.data, source: 'env', invalidStored };
  }
  return { value: definition.fallback, source: 'fallback', invalidStored };
}
