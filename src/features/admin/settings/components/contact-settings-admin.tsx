import 'server-only';
import { AdminSection } from '@/components/admin/admin-section';
import type { ActionState } from '@/lib/action-state';
import { DEPLOYMENT_SETTINGS } from '@/lib/deployment-settings/registry';
import {
  listDeploymentSettingChanges,
  readDeploymentSetting,
} from '@/lib/deployment-settings/store';
import { FALLBACK_DISPLAY_FORMAT } from '@/lib/format/display-format';
import { formatDateTime } from '@/lib/format/format-date';
import { withRequestContext } from '@/lib/request-context';
import { DeploymentSettingText } from './deployment-setting-text';

/** The contact details on the admin Brand page, which an admin changes without a redeploy. */
export async function ContactSettingsAdmin({
  save,
}: {
  save: (key: string, value: unknown) => Promise<ActionState<void>>;
}) {
  const definition = DEPLOYMENT_SETTINGS.supportEmail;
  const { setting, changes } = await withRequestContext(
    { route: 'admin-brand-page', op: 'contact-settings' },
    async () => ({
      setting: await readDeploymentSetting('supportEmail'),
      changes: await listDeploymentSettingChanges('supportEmail'),
    }),
  );
  return (
    <AdminSection id="brand-contact" title="Contact" support={definition.description}>
      <DeploymentSettingText
        settingKey="supportEmail"
        label={definition.label}
        value={setting.value}
        inputType="email"
        source={setting.source}
        envKey={definition.envKey}
        changes={changes.map((change) => ({
          label: typeof change.value === 'string' ? change.value : 'The environment value',
          by: change.changedBy ?? 'Local console',
          at: formatDateTime(change.changedAt, FALLBACK_DISPLAY_FORMAT),
        }))}
        save={save}
      />
    </AdminSection>
  );
}
