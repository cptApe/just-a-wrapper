import { desc, eq } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db';
import { deploymentSetting, user } from '@/db/schema';
import { env } from '../env';
import { AppError } from '../errors';
import { captureException } from '../observability';
import {
  DEPLOYMENT_SETTINGS,
  type DeploymentSettingKey,
  type ResolvedSetting,
  resolveDeploymentSetting,
} from './registry';

async function latestStoredValue(key: DeploymentSettingKey): Promise<unknown> {
  const row = (
    await db
      .select({ value: deploymentSetting.value })
      .from(deploymentSetting)
      .where(eq(deploymentSetting.key, key))
      .orderBy(desc(deploymentSetting.changedAt), desc(deploymentSetting.id))
      .limit(1)
  ).at(0);
  return row?.value ?? null;
}

function envValueOf(key: DeploymentSettingKey): string | undefined {
  const raw = (env as Record<string, unknown>)[DEPLOYMENT_SETTINGS[key].envKey];
  return typeof raw === 'string' ? raw : undefined;
}

async function readSetting<K extends DeploymentSettingKey>(key: K): Promise<ResolvedSetting<K>> {
  const resolved = resolveDeploymentSetting(key, {
    stored: await latestStoredValue(key),
    envValue: envValueOf(key),
  });
  if (resolved.invalidStored)
    captureException(
      new AppError('VALIDATION_FAILED', 'A stored deployment setting is no longer valid', { key }),
    );
  return { value: resolved.value, source: resolved.source };
}

// One read per key per server request; outside a request (webhooks, crons, scripts) every call reads.
const cachedRead = cache(readSetting);

/** The current value and where it came from: the admin console, env, or the built-in fallback. */
export function readDeploymentSetting<K extends DeploymentSettingKey>(
  key: K,
): Promise<ResolvedSetting<K>> {
  return cachedRead(key);
}

/**
 * Stores a new value, or clears the stored one with null so env applies again. The value is
 * checked against the setting's schema here, so a caller may pass what a form sent. Each call adds
 * a row, which is the audit of who changed what and when.
 */
export async function writeDeploymentSetting(input: {
  key: DeploymentSettingKey;
  value: unknown;
  actorUserId: string | null;
}): Promise<void> {
  const definition = DEPLOYMENT_SETTINGS[input.key];
  const parsed = input.value === null ? null : definition.schema.safeParse(input.value);
  if (parsed && !parsed.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      `That is not a valid ${definition.label.toLowerCase()}.`,
      {
        key: input.key,
      },
    );
  }
  await db.insert(deploymentSetting).values({
    key: input.key,
    value: parsed ? parsed.data : null,
    changedByUserId: input.actorUserId,
  });
}

export type DeploymentSettingChange = {
  value: unknown;
  /** Who changed it, or null for the open local console or a removed account. */
  changedBy: string | null;
  changedAt: Date;
};

/** The newest changes to one setting, newest first. */
export async function listDeploymentSettingChanges(
  key: DeploymentSettingKey,
  limit = 5,
): Promise<DeploymentSettingChange[]> {
  return db
    .select({
      value: deploymentSetting.value,
      changedBy: user.email,
      changedAt: deploymentSetting.changedAt,
    })
    .from(deploymentSetting)
    .leftJoin(user, eq(user.id, deploymentSetting.changedByUserId))
    .where(eq(deploymentSetting.key, key))
    .orderBy(desc(deploymentSetting.changedAt), desc(deploymentSetting.id))
    .limit(limit);
}
