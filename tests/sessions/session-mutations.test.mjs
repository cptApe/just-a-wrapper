/** Chat rename and delete rollbacks in a real browser: a failure undoes only its own change. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { hookBrowser, requestCount, settled } from './cache-hooks-browser.mjs';

let browser;
before(async () => {
  browser = await hookBrowser();
});
after(async () => {
  await browser?.close();
});

test('a failed delete puts back only its own row, on its own page, with its live status', async (t) => {
  const page = await browser.page(t);
  await page.evaluate(() => window.harness.mutations.remove('c'));
  await requestCount(page, 1);
  await page.evaluate(() => window.harness.otherMutations.remove('b'));
  await requestCount(page, 2);
  await page.evaluate(() => {
    window.harness.live('a', 'running');
    window.harness.respond(1, 204);
  });
  await settled(page, 1);
  await page.evaluate(() => window.harness.respond(0, 500));
  await settled(page);
  const cache = await page.evaluate(() =>
    window.harness.client.getQueryData(window.harness.listKey),
  );
  assert.deepEqual(
    cache.pages.map((p) => p.items.map((r) => r.id)),
    [['a'], ['c']],
  );
  assert.equal(cache.pages[0].items[0].status, 'running');
  assert.deepEqual(cache.pageParams, [null, 'older']);
});

test('a failed rename never brings back a chat deleted meanwhile', async (t) => {
  const page = await browser.page(t);
  await page.evaluate(() => window.harness.mutations.rename('a', 'Changed'));
  await requestCount(page, 1);
  await page.evaluate(() => window.harness.mutations.remove('a'));
  await requestCount(page, 2);
  await page.evaluate(() => window.harness.respond(1, 204));
  await settled(page, 1);
  await page.evaluate(() => window.harness.respond(0, 500));
  await settled(page);
  assert.deepEqual(await page.evaluate(() => window.harness.rows().map((r) => r.id)), ['b', 'c']);
});
