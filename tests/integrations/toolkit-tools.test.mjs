import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listToolkitTools } from '../../src/lib/composio/toolkit-tools.ts';

test("every page of an app's action catalog is read, so no action is missing its permission row", async (context) => {
  const requests = [];
  context.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(new URL(url));
    return Response.json(
      requests.length === 1
        ? {
            items: [
              { slug: 'READ', name: 'Read', description: null, tags: ['read', 4] },
              { slug: '' },
            ],
            next_cursor: 'page-2',
            total_items: 2,
          }
        : { items: [{ slug: 'WRITE', name: 1 }], next_cursor: null },
    );
  });
  const catalog = await listToolkitTools('catalog-test-pages', 'test-key');
  assert.deepEqual(catalog, {
    tools: [
      { slug: 'READ', name: 'Read', description: '', tags: ['read'] },
      { slug: 'WRITE', name: '', description: '', tags: [] },
    ],
    totalCount: 2,
  });
  assert.equal(requests[1].searchParams.get('cursor'), 'page-2');
  assert.equal(await listToolkitTools('catalog-test-pages', 'test-key'), catalog);
  assert.equal(requests.length, 2);
});

test('a failed catalog read is not remembered, so the next open tries again', async (context) => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return Response.json(calls === 1 ? { items: 'invalid' } : { items: [] });
  });
  await assert.rejects(listToolkitTools('catalog-test-invalid', 'test-key'), {
    code: 'EXTERNAL_API_FAILED',
    message: 'Composio tools catalog response is invalid',
  });
  assert.deepEqual(await listToolkitTools('catalog-test-invalid', 'test-key'), {
    tools: [],
    totalCount: 0,
  });
});
