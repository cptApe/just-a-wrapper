// Provider calls behind event tasks and reviews: the right account is used, and a missing trigger or review is told apart from an outage.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deleteTriggerInstance,
  requireActiveConnectedAccount,
  setTriggerInstanceStatus,
} from '../../src/features/tasks/api/composio-triggers.ts';
import { classifyReviewRetrieveStatus } from '../../src/features/tasks/lib/review-retrieve-error.ts';

test('an event task uses only an active account of the requested app, and no account means not connected', async (context) => {
  const fetch = context.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      items: [
        { id: 'disabled', status: 'INACTIVE', toolkit: { slug: 'gmail' } },
        { id: 'other', status: 'ACTIVE', toolkit: { slug: 'slack' } },
        { id: 'selected', status: 'ACTIVE', toolkit: { slug: 'GMAIL' } },
      ],
    }),
  );
  assert.deepEqual(await requireActiveConnectedAccount('member', 'key', 'gmail'), {
    connectedAccountId: 'selected',
  });
  fetch.mock.restore();
  context.mock.method(globalThis, 'fetch', async () => Response.json({ items: [] }));
  await assert.rejects(requireActiveConnectedAccount('member', 'key', 'gmail'), {
    code: 'INTEGRATION_NOT_CONNECTED',
  });
});

test('a trigger already gone counts as removed, while a provider outage fails the change', async (context) => {
  const gone = context.mock.method(
    globalThis,
    'fetch',
    async () => new Response('', { status: 404 }),
  );
  await deleteTriggerInstance('key', 'deleted');
  assert.equal(await setTriggerInstanceStatus('key', 'deleted', 'enable'), 'missing');
  gone.mock.restore();
  context.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(setTriggerInstanceStatus('key', 'trigger', 'disable'), {
    code: 'EXTERNAL_API_FAILED',
  });
  await assert.rejects(deleteTriggerInstance('key', 'trigger'), { code: 'EXTERNAL_API_FAILED' });
});

test('a review fetch retries only on outages, so a refused one is not retried forever and an outage is not lost', () => {
  assert.equal(classifyReviewRetrieveStatus(404), 'unknown_session');
  for (const status of [400, 401, 403, 409, 422, 499])
    assert.equal(classifyReviewRetrieveStatus(status), 'graceful');
  for (const status of [undefined, 500, 502, 503])
    assert.equal(classifyReviewRetrieveStatus(status), 'retry');
});
