import { brandPlaceholders } from '@content/brand';
import { DEPLOYMENT_SETTINGS, type DeploymentSettingKey } from '../deployment-settings/registry';
import { isProductionDeployment } from '../env-schema';
import { AppError } from '../errors';

// The brand values that ship as placeholders. pnpm validate:config and a production build both
// list the ones still unset with these same sentences. NEXT_PUBLIC_APP_URL is required everywhere
// by env-schema.ts, so it is not repeated here.

type Environment = Readonly<Record<string, string | undefined>>;

function isSet(environment: Environment, key: string): boolean {
  return (environment[key]?.trim() ?? '') !== '';
}

/**
 * One sentence per brand value still on its placeholder. `storedKeys` are the settings an admin
 * stored in the console, which count as set.
 */
export function unsetBrandValues(
  environment: Environment,
  storedKeys: ReadonlySet<DeploymentSettingKey> = new Set(),
): string[] {
  const errors: string[] = [];
  if (!isSet(environment, 'NEXT_PUBLIC_BRAND_NAME')) {
    errors.push(
      `NEXT_PUBLIC_BRAND_NAME is not set, so the app is called "${brandPlaceholders.name}". Set it to your product name.`,
    );
  }
  for (const [key, definition] of Object.entries(DEPLOYMENT_SETTINGS)) {
    if (!definition.required) continue;
    if (isSet(environment, definition.envKey)) continue;
    if (storedKeys.has(key as DeploymentSettingKey)) continue;
    errors.push(
      `${definition.label} is not set, so the app shows "${String(definition.fallback)}". Set ${definition.envKey}, or set it in the admin console where the console runs.`,
    );
  }
  return errors;
}

/**
 * Refuses a production deployment that still runs on placeholders. Production has no admin
 * console, so env is the only place these values can come from there.
 */
export function assertBrandConfigured(
  environment: Environment & { NODE_ENV?: string; VERCEL_ENV?: string },
): void {
  if (!isProductionDeployment(environment)) return;
  const errors = unsetBrandValues(environment);
  if (errors.length > 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      `This production deployment still uses placeholder brand values. ${errors.join(' ')}`,
      { unset: errors.length },
    );
  }
}
