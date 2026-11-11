// Deployment settings as the app resolves them, for operator scripts. With DATABASE_URL set it reads
// the values an admin stored in the console, so a script and the app never disagree; without it a
// script uses each setting's env value, then its fallback.
import {
  DEPLOYMENT_SETTINGS,
  type DeploymentSettingKey,
  type ResolvedSetting,
  resolveDeploymentSetting,
} from '../src/lib/deployment-settings/registry.ts';

export async function deploymentSettingsForScript<K extends DeploymentSettingKey>(
  keys: readonly K[],
): Promise<{ [P in K]: ResolvedSetting<P> }> {
  const resolved = {} as { [P in K]: ResolvedSetting<P> };
  if (!process.env.DATABASE_URL) {
    for (const key of keys) {
      const { value, source } = resolveDeploymentSetting(key, {
        stored: null,
        envValue: process.env[DEPLOYMENT_SETTINGS[key].envKey],
      });
      resolved[key] = { value, source } as ResolvedSetting<typeof key>;
    }
    return resolved;
  }
  const [{ readDeploymentSetting }, { db }] = await Promise.all([
    import('../src/lib/deployment-settings/store.ts'),
    import('../src/db/index.ts'),
  ]);
  try {
    for (const key of keys) resolved[key] = await readDeploymentSetting(key);
    return resolved;
  } finally {
    // The pool would keep the script alive after it finishes.
    await db.$client.end();
  }
}
