import 'server-only';
import { AdminSection } from '@/components/admin/admin-section';
import type { ActionState } from '@/lib/action-state';
import {
  BILLING_MODES,
  type BillingMode,
  DEPLOYMENT_SETTINGS,
} from '@/lib/deployment-settings/registry';
import {
  listDeploymentSettingChanges,
  readDeploymentSetting,
} from '@/lib/deployment-settings/store';
import { FALLBACK_DISPLAY_FORMAT } from '@/lib/format/display-format';
import { formatDateTime } from '@/lib/format/format-date';
import { withRequestContext } from '@/lib/request-context';
import { capabilities } from '@/lib/runtime-capabilities';
import { DeploymentSettingChoice } from './deployment-setting-choice';

const MODE_LABELS: Record<BillingMode, string> = {
  subscriptions: 'Subscriptions',
  credits_only: 'Credits only',
};

function modeLabel(value: unknown): string {
  const mode = BILLING_MODES.find((candidate) => candidate === value);
  return mode ? MODE_LABELS[mode] : 'The environment value';
}

/** The billing mode control on the admin Pricing page. */
export async function BillingModeAdmin({
  save,
}: {
  save: (key: string, value: unknown) => Promise<ActionState<void>>;
}) {
  const definition = DEPLOYMENT_SETTINGS.billingMode;
  const { setting, changes } = await withRequestContext(
    { route: 'admin-pricing-page', op: 'billing-mode' },
    async () => ({
      setting: await readDeploymentSetting('billingMode'),
      changes: await listDeploymentSettingChanges('billingMode'),
    }),
  );
  return (
    <AdminSection
      title="How you sell"
      support={
        capabilities.billing.kind === 'off'
          ? `${definition.description} Billing is off until STRIPE_SECRET_KEY is set.`
          : definition.description
      }
    >
      <DeploymentSettingChoice
        settingKey="billingMode"
        label={definition.label}
        value={setting.value}
        options={BILLING_MODES.map((mode) => ({ value: mode, label: MODE_LABELS[mode] }))}
        source={setting.source}
        envKey={definition.envKey}
        changes={changes.map((change) => ({
          label: change.value === null ? 'The environment value' : modeLabel(change.value),
          by: change.changedBy ?? 'Local console',
          at: formatDateTime(change.changedAt, FALLBACK_DISPLAY_FORMAT),
        }))}
        save={save}
      />
    </AdminSection>
  );
}
