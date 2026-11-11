// The billing mode as the app resolves it, for operator scripts (see ./deployment-settings.ts).
import type { BillingMode, SettingSource } from '../src/lib/deployment-settings/registry.ts';
import { deploymentSettingsForScript } from './deployment-settings.ts';

export async function billingModeForScript(): Promise<{
  mode: BillingMode;
  source: SettingSource;
}> {
  const { billingMode } = await deploymentSettingsForScript(['billingMode']);
  return { mode: billingMode.value, source: billingMode.source };
}

export function describeBillingMode({
  mode,
  source,
}: {
  mode: BillingMode;
  source: SettingSource;
}): string {
  const from =
    source === 'stored'
      ? 'set in the admin console'
      : source === 'env'
        ? 'from BILLING_MODE'
        : 'the default';
  return `Billing mode: ${mode === 'subscriptions' ? 'subscriptions' : 'credits only'} (${from}).`;
}
