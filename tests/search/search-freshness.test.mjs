/** Unit hook regressions: real React, QueryClient and mutation invalidation; mocked HTTP only. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { hookBrowser, requestCount, settled } from '../sessions/cache-hooks-browser.mjs';

let browser;
before(async () => {
  browser = await hookBrowser();
});
after(async () => {
  await browser?.close();
});
const ready = (page) => page.waitForFunction(() => window.harness.search.state.kind === 'success');

test('a deleted chat does not come back when the same search runs again', async (t) => {
  const page = await browser.page(t);
  await page.evaluate(() => {
    window.harness.setResults([{ group: 'task', id: 'a', title: 'Client a', href: '/app/task/a' }]);
    window.harness.setSearch('client a', true);
  });
  await ready(page);
  assert.equal(await page.evaluate(() => window.harness.search.state.results[0].id), 'a');
  await page.evaluate(() => {
    window.harness.setSearch('client a', false);
    window.harness.mutations.remove('a');
  });
  await requestCount(page, 1);
  await page.evaluate(() => {
    window.harness.setResults([]);
    window.harness.respond(0, 204);
  });
  await settled(page);
  assert.equal(
    await page.evaluate(
      () =>
        window.harness.client.getQueryState(
          window.harness.searchQueryKeys.results('workspace', 'client a'),
        ).isInvalidated,
    ),
    true,
  );
  await page.evaluate(() => window.harness.setSearch('client a', true));
  await ready(page);
  await page.waitForFunction(() => window.harness.search.state.results.length === 0);
  assert.equal(await page.evaluate(() => window.harness.searchCalls()), 2);
});

test('reopening search shows a new server match and keeps the earlier ones', async (t) => {
  const page = await browser.page(t);
  await page.evaluate(() => window.harness.setSearch('client', true));
  await ready(page);
  assert.deepEqual(
    await page.evaluate(() => window.harness.search.state.results.map((r) => r.id)),
    ['a', 'b', 'c', 'older'],
  );
  await page.evaluate(() => window.harness.setSearch('client', false));
  await page.evaluate(() => {
    window.harness.setResults([
      { group: 'task', id: 'new', title: 'Client message', href: '/app/task/new' },
    ]);
    window.harness.setSearch('client', true);
  });
  await page.waitForFunction(() =>
    window.harness.search.state.results?.some((r) => r.id === 'new'),
  );
  assert.deepEqual(
    await page.evaluate(() => window.harness.search.state.results.map((r) => r.id)),
    ['a', 'b', 'c', 'new'],
  );
});

test('a chat deleted in another tab is gone from Recents when search reopens', async (t) => {
  const page = await browser.page(t);
  await page.evaluate(() => window.harness.setSearch('client a', true));
  await ready(page);
  await page.evaluate(() => window.harness.setSearch('client a', false));
  await page.evaluate(() => {
    const h = window.harness;
    h.setResults([]);
    // The sidebar's active list observer, with the server now omitting task A.
    const observer = new h.QueryObserver(h.client, {
      queryKey: h.listKey,
      staleTime: Infinity,
      queryFn: async () => ({
        pages: [{ items: h.rows().filter((row) => row.id !== 'a'), nextCursor: null }],
        pageParams: [null],
      }),
    });
    h.unsubscribeList = observer.subscribe(() => {});
    h.setSearch('client a', true);
  });
  await page.waitForFunction(
    () =>
      window.harness.search.state.kind === 'success' &&
      window.harness.search.state.results.length === 0,
  );
  assert.ok(!(await page.evaluate(() => window.harness.rows())).some((row) => row.id === 'a'));
  await page.evaluate(() => window.harness.unsubscribeList());
});
