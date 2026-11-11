import { resolveCapabilitiesFromEnv } from './capabilities';
import { CAPABILITY_OFF_MESSAGES } from './capability-messages';
import type { BillingMode } from './deployment-settings/registry';
import { env, nodeEnv } from './env';
import { AppError, CapabilityOffError } from './errors';

export const capabilities = resolveCapabilitiesFromEnv({ ...env, NODE_ENV: nodeEnv });

export type BillingCapability = { kind: 'off' } | { kind: 'stripe'; mode: BillingMode };

/**
 * Billing with its sale mode. Stripe keys turn billing on at startup; the mode is a deployment
 * setting (env, overridden from the admin console), so it is read here rather than at startup.
 * Every place that behaves differently by mode asks this function.
 */
export async function billingCapability(): Promise<BillingCapability> {
  if (capabilities.billing.kind === 'off') return { kind: 'off' };
  // Loaded on use, so modules that only read the startup capabilities do not load the database.
  const { readDeploymentSetting } = await import('./deployment-settings/store');
  const { value } = await readDeploymentSetting('billingMode');
  return { kind: 'stripe', mode: value };
}

// Browser endpoints also serve direct UI requests, outside custom-tool dispatch.
export function browserbaseCapability() {
  if (capabilities.browser.kind !== 'browserbase') {
    throw new AppError('TOOL_NOT_FOUND', 'Browserbase is disabled on this deployment');
  }
  return capabilities.browser;
}

export function composioCapability() {
  if (capabilities.connectedApps.kind !== 'composio') {
    throw new CapabilityOffError(CAPABILITY_OFF_MESSAGES.connectedApps);
  }
  return capabilities.connectedApps;
}

export function exaCapability() {
  if (capabilities.webSearch.kind !== 'exa') {
    throw new AppError('TOOL_NOT_FOUND', 'Exa is disabled on this deployment');
  }
  return capabilities.webSearch;
}

export function storageCapability() {
  if (capabilities.storage.kind !== 'vercel-blob') {
    throw new CapabilityOffError(CAPABILITY_OFF_MESSAGES.uploads);
  }
  return capabilities.storage;
}
