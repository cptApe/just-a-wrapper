// Deployment settings on real Postgres: a stored value overrides env, changes are audited, and billing mode and support email follow the store.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { assertCanStartChat } from '@/features/billing/api/assert-plan-limits';
import { planLimits } from '@/features/billing/api/plan-limits';
import { NO_PLAN_LIMITS, PLANS } from '@/features/billing/pricing-config';
import { notificationEmail } from '@/features/notifications/lib/notification-email';
import { readContactDetails } from '@/lib/brand/contact';
import {
  listDeploymentSettingChanges,
  readDeploymentSetting,
  writeDeploymentSetting,
} from '@/lib/deployment-settings/store';
import { billingCapability } from '@/lib/runtime-capabilities';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

// vitest.config.ts sets BILLING_MODE=credits_only as the env base.

const pool = makeTestPool();
const db = makeTestDb(pool);

beforeAll(async () => {
  await applyMigrations(db);
});

beforeEach(async () => {
  await truncateAll(db);
  await seedUser(db, 'admin_1', 'admin@example.test');
});

afterAll(async () => {
  await pool.end();
});

async function seedPlanlessWorkspace(): Promise<string> {
  await seedOrganization(db, 'org_settings');
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into workspace (organization_id, name) values ('org_settings', 'ws') returning id`,
  );
  return requiredRow(rows.at(0)).id;
}

async function seedRunningChat(workspaceId: string): Promise<void> {
  await db.execute(
    sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, status)
        values ('read_write', ${workspaceId}, 'default', 'admin_1', 'chat', 'running')`,
  );
}

describe('deployment settings store', () => {
  test('an admin-stored value overrides env, and clearing it hands the decision back to env', async () => {
    expect(await readDeploymentSetting('billingMode')).toEqual({
      value: 'credits_only',
      source: 'env',
    });

    await writeDeploymentSetting({
      key: 'billingMode',
      value: 'subscriptions',
      actorUserId: 'admin_1',
    });
    expect(await readDeploymentSetting('billingMode')).toEqual({
      value: 'subscriptions',
      source: 'stored',
    });

    await writeDeploymentSetting({ key: 'billingMode', value: null, actorUserId: null });
    expect(await readDeploymentSetting('billingMode')).toEqual({
      value: 'credits_only',
      source: 'env',
    });
  });

  test('an invalid value is refused and nothing is written', async () => {
    await expect(
      writeDeploymentSetting({ key: 'billingMode', value: 'free_for_all', actorUserId: 'admin_1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await listDeploymentSettingChanges('billingMode')).toEqual([]);
  });

  test('every change is kept in the audit trail with who made it, newest first', async () => {
    await writeDeploymentSetting({
      key: 'billingMode',
      value: 'subscriptions',
      actorUserId: 'admin_1',
    });
    await writeDeploymentSetting({ key: 'billingMode', value: null, actorUserId: null });
    const changes = await listDeploymentSettingChanges('billingMode');
    expect(changes.map(({ value, changedBy }) => ({ value, changedBy }))).toEqual([
      { value: null, changedBy: null },
      { value: 'subscriptions', changedBy: 'admin@example.test' },
    ]);
  });

  test('a stored mode the code no longer knows is ignored instead of breaking billing', async () => {
    await db.execute(
      sql`insert into deployment_setting (key, value) values ('billingMode', '"retired_mode"'::jsonb)`,
    );
    expect(await readDeploymentSetting('billingMode')).toEqual({
      value: 'credits_only',
      source: 'env',
    });
  });
});

describe('switching the billing mode in the store', () => {
  test('switching to subscriptions limits a workspace without a plan to one chat at a time', async () => {
    const workspaceId = await seedPlanlessWorkspace();
    await seedRunningChat(workspaceId);

    expect(await billingCapability()).toEqual({ kind: 'stripe', mode: 'credits_only' });
    expect(await planLimits('none')).toEqual(PLANS.max.limits);
    await expect(
      db.transaction((tx) => assertCanStartChat(workspaceId, tx)),
    ).resolves.toBeUndefined();

    await writeDeploymentSetting({
      key: 'billingMode',
      value: 'subscriptions',
      actorUserId: 'admin_1',
    });
    expect(await billingCapability()).toEqual({ kind: 'stripe', mode: 'subscriptions' });
    expect(await planLimits('none')).toEqual(NO_PLAN_LIMITS);
    await expect(db.transaction((tx) => assertCanStartChat(workspaceId, tx))).rejects.toMatchObject(
      { code: 'PLAN_LIMIT_REACHED' },
    );
  });
});

describe('the support email in the store', () => {
  test('an admin-saved support address reaches outgoing email, and a malformed one is refused', async () => {
    // vitest.config.ts sets no SUPPORT_EMAIL, so the placeholder stands in.
    expect(await readContactDetails()).toEqual({ supportEmail: 'support@example.com' });

    await writeDeploymentSetting({
      key: 'supportEmail',
      value: ' help@acme.example ',
      actorUserId: 'admin_1',
    });
    const contact = await readContactDetails();
    expect(contact).toEqual({ supportEmail: 'help@acme.example' });
    expect(notificationEmail('task.completed', { link: '/app' }, contact).text).toContain(
      'Questions? help@acme.example',
    );

    await expect(
      writeDeploymentSetting({
        key: 'supportEmail',
        value: 'not an email',
        actorUserId: 'admin_1',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await readContactDetails()).toEqual({ supportEmail: 'help@acme.example' });
  });
});
