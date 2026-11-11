/** Connected-app accounts at the Composio edge: a member's credentials reach only the people they
 * were shared with, and a disconnect or cleanup removes exactly that member's accounts.
 * HTTP is the boundary; the wire shapes follow Composio's published API. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { deleteMemberAccounts } from '../../src/features/integrations/composio/delete-member-accounts.ts';
import { disconnectToolkitAccounts } from '../../src/features/integrations/composio/disconnect.ts';
import {
  createConnectLink,
  listOwnActiveToolkits,
  setSharedAccountAccess,
} from '../../src/features/integrations/composio/shared-connections.ts';
import { loadTsx } from '../support/load-tsx.mjs';

const mintPath = 'src/features/integrations/composio/tool-router.ts';
const requireMint = createRequire(new URL(`../../${mintPath}`, import.meta.url));
const { mintToolRouterSession } = loadTsx(mintPath, (specifier) =>
  specifier === 'server-only' ? {} : requireMint(specifier),
);

function stubFetch(context, respond) {
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', body: options.body });
    return respond(String(url), options);
  });
  return calls;
}
const deletes = (calls) => calls.filter((call) => call.method === 'DELETE').map((call) => call.url);

test('a shared account is limited to the named members, and a member link stays private', async (context) => {
  const calls = stubFetch(context, () =>
    Response.json({ redirect_url: 'https://link', connected_account_id: 'ca_1' }),
  );
  await createConnectLink({
    sessionId: 'trs_1',
    toolkit: 'gmail',
    apiKey: 'key',
    shareWith: ['member-a', 'member-b'],
  });
  await createConnectLink({ sessionId: 's', toolkit: 'gmail', apiKey: 'key', shareWith: null });
  assert.deepEqual(JSON.parse(calls[0].body), {
    toolkit: 'gmail',
    experimental: {
      account_type: 'SHARED',
      acl_config_for_shared: { allowed_user_ids: ['member-a', 'member-b'] },
    },
  });
  assert.deepEqual(JSON.parse(calls[1].body), { toolkit: 'gmail' });
});

test('changing who may use a shared account replaces the list and never opens it to everyone', async (context) => {
  const calls = stubFetch(context, () => Response.json({ success: true }));
  await setSharedAccountAccess('ca_1', ['member-a'], 'key');
  assert.equal(calls[0].method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].body), {
    experimental: { acl_config_for_shared: { allowed_user_ids: ['member-a'] } },
  });
});

test("a member's agent session carries a shared account only when one is shared with them", async (context) => {
  const calls = stubFetch(context, () =>
    Response.json({ session_id: 's', mcp: { url: 'https://router.example/mcp' } }),
  );
  await mintToolRouterSession('member-1', 'test-key', {});
  await mintToolRouterSession('member-1', 'test-key', { gmail: 'ca_shared' });
  assert.equal('connected_accounts' in JSON.parse(calls[0].body), false);
  assert.deepEqual(JSON.parse(calls[1].body).connected_accounts, { gmail: ['ca_shared'] });
});

test("a member's own apps never include a teammate's account or an expired one", async (context) => {
  stubFetch(context, () =>
    Response.json({
      items: [
        { user_id: 'me', status: 'ACTIVE', toolkit: { slug: 'GMAIL' } },
        { user_id: 'me', status: 'EXPIRED', toolkit: { slug: 'notion' } },
        { user_id: 'teammate', status: 'ACTIVE', toolkit: { slug: 'stripe' } },
      ],
      next_cursor: null,
    }),
  );
  assert.deepEqual([...(await listOwnActiveToolkits('me', 'key'))], ['gmail']);
});

test('disconnecting one app removes its accounts on every page and leaves other apps connected', async (context) => {
  const calls = stubFetch(context, (url, options) => {
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    const cursor = new URL(url).searchParams.get('cursor');
    return Response.json({
      items:
        cursor === null
          ? [
              { id: 'gmail-first', toolkit: { slug: 'GMAIL' } },
              { id: 'slack-account', toolkit: { slug: 'slack' } },
            ]
          : [{ id: 'gmail-second', toolkit: { slug: 'gmail' } }],
      next_cursor: cursor === null ? 'page-two' : null,
    });
  });
  assert.deepEqual(await disconnectToolkitAccounts('member-1', 'test-key', 'gmail'), {
    removed: 2,
  });
  const deleted = deletes(calls);
  assert.equal(deleted.length, 2);
  assert.ok(deleted.every((url) => /gmail-(first|second)$/.test(url)));
});

test('a disconnect that cannot read the account list deletes nothing and reports the failure', async (context) => {
  for (const items of [
    'invalid',
    [null, { id: null, toolkit: null }, { id: 'valid', toolkit: { slug: 'gmail' } }],
  ]) {
    const calls = stubFetch(context, (_url, options) =>
      options.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ items }),
    );
    await assert.rejects(disconnectToolkitAccounts('member-1', 'test-key', 'gmail'), {
      code: 'EXTERNAL_API_FAILED',
    });
    assert.deepEqual(deletes(calls), []);
    context.mock.restoreAll();
  }
});

test("removing a member deletes only that member's accounts, never another tenant's", async (context) => {
  const calls = stubFetch(context, (_url, options) =>
    options.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : Response.json({
          items: [
            { id: 'mine', user_id: 'owner' },
            { id: 'other', user_id: 'someone-else' },
          ],
          next_cursor: null,
        }),
  );
  await deleteMemberAccounts('owner', 'test-key', Date.now() + 10000);
  const deleted = deletes(calls);
  assert.equal(deleted.length, 1);
  assert.ok(deleted[0].endsWith('/mine'));
});
