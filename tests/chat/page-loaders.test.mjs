// Home and task pages open when a side read fails, and a first sign-up gets exactly one workspace.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError } from '../../src/lib/errors.ts';
import { loadTsx } from '../support/load-tsx.mjs';

function modulesFor({
  billingFails,
  uploadFails,
  activeOrganizationId = 'org',
  ensureWorkspace = async () => 'org',
  workspaceName = async () => 'Workspace',
}) {
  const captured = [];
  const shared = {
    'server-only': {},
    'next/headers': { headers: async () => new Headers() },
    '@/lib/errors': { AppError },
    '@/lib/logger': { logger: () => ({}) },
    '@/lib/observability': { captureException: (_error, context) => captured.push(context.op) },
    '@/lib/request-context': { withRequestContext: (_context, run) => run() },
    '@/lib/runtime-capabilities': { capabilities: { billing: { kind: 'stripe' } } },
    '@/lib/request-session': {
      getRequestSession: async () => ({
        session: { activeOrganizationId },
        user: { name: 'Ada', timezone: null, browserTimezone: null },
      }),
    },
    '@/features/billing': {
      getBillingSummary: async () => {
        if (billingFails) throw new Error('billing down');
        return {
          creditBalance: 5,
          isSubscribed: false,
          planTier: 'none',
          planCreditsExpireAt: null,
          workspaceId: 'workspace',
          creditResetAt: null,
        };
      },
      getCycleCreditsUsed: async () => 0,
    },
    '@/lib/caller': { resolveCaller: async () => ({ workspaceId: 'workspace' }) },
    '@/features/files/server': {
      uploadConfig: async () => {
        if (uploadFails) throw new Error('settings down');
        return { enabled: true, uploadTag: 'tag', maxFileBytes: 1 };
      },
    },
    '@/features/preferences/lib/time-preferences': { resolveEffectiveTimeZone: () => 'UTC' },
    '@/features/workspaces/api/get-workspace-name': { getWorkspaceName: workspaceName },
    '@/features/workspaces/api/ensure-request-organization': {
      ensureRequestOrganization: ensureWorkspace,
    },
    '@/features/session-runtime': {
      getWorkspaceSession: async () => ({ id: 'session' }),
    },
    '@/features/sessions': {
      loadSessionStatus: async () => 'idle',
      resolveSessionUuidByAnthropicId: async () => null,
    },
    '@/lib/caller': {
      resolveCaller: async () => ({
        workspaceId: 'workspace',
        organizationId: 'org',
        userId: 'user',
      }),
    },
    '../lib/greeting': { buildGreeting: () => 'Hello' },
    './thread-members': { loadThreadMembers: async () => [] },
  };
  const resolve = (name) => {
    if (name === './load-page-upload-config')
      return loadTsx('src/features/chat/api/load-page-upload-config.ts', resolve);
    assert.ok(name in shared, name);
    return shared[name];
  };
  return { resolve, captured };
}

test('Home still opens when the billing read fails', async () => {
  const { resolve, captured } = modulesFor({ billingFails: true });
  const { loadHomePage } = loadTsx('src/features/chat/api/load-home-page.ts', resolve);
  const page = await loadHomePage();
  assert.equal(page.kind, 'ready');
  assert.equal(page.billing, null);
  assert.deepEqual(captured, ['home-billing']);
});

test('Home still opens, with uploads off, when the upload-settings read fails', async () => {
  const { resolve, captured } = modulesFor({ uploadFails: true });
  const { loadHomePage } = loadTsx('src/features/chat/api/load-home-page.ts', resolve);
  const page = await loadHomePage();
  assert.equal(page.attach.uploadConfig.enabled, false);
  assert.deepEqual(captured, ['page-upload-config']);
});

test('a first sign-up waits for its new workspace instead of showing a missing one', async () => {
  let provisioned;
  const looked = [];
  const { resolve } = modulesFor({
    activeOrganizationId: null,
    ensureWorkspace: () =>
      new Promise((done) => {
        provisioned = done;
      }),
    workspaceName: async (organizationId) => {
      looked.push(organizationId);
      return 'Workspace';
    },
  });
  const { loadHomePage } = loadTsx('src/features/chat/api/load-home-page.ts', resolve);
  let settled = false;
  const loading = loadHomePage().finally(() => {
    settled = true;
  });
  await new Promise((done) => setImmediate(done));
  assert.equal(settled, false);
  assert.deepEqual(looked, []);
  provisioned('org-new');
  const page = await loading;
  assert.equal(page.kind, 'ready');
  assert.equal(page.organizationId, 'org-new');
  assert.deepEqual(looked, ['org-new']);
});

test('the layout and the page of one request create only one workspace', async () => {
  const calls = [];
  const { ensureRequestOrganization } = loadTsx(
    'src/features/workspaces/api/ensure-request-organization.ts',
    (name) => {
      const modules = {
        'server-only': {},
        'next/headers': { headers: async () => 'request-headers' },
        react: {
          cache: (load) => {
            let shared;
            return () => {
              shared ??= load();
              return shared;
            };
          },
        },
        '@/lib/request-session': { getRequestSession: async () => 'session' },
        './ensure-personal-workspace': {
          ensurePersonalWorkspace: async (headers, session) => {
            calls.push([headers, session]);
            return 'org-new';
          },
        },
      };
      assert.ok(name in modules, name);
      return modules[name];
    },
  );
  assert.deepEqual(await Promise.all([ensureRequestOrganization(), ensureRequestOrganization()]), [
    'org-new',
    'org-new',
  ]);
  assert.deepEqual(calls, [['request-headers', 'session']]);
});

test('a task still opens when the upload-settings read fails', async () => {
  const { resolve, captured } = modulesFor({ uploadFails: true });
  const { loadTaskPage } = loadTsx('src/features/chat/api/load-task-page.ts', resolve);
  const page = await loadTaskPage('session');
  assert.equal(page.kind, 'task');
  assert.equal(page.props.uploadConfig.enabled, false);
  assert.deepEqual(captured, ['page-upload-config']);
});
