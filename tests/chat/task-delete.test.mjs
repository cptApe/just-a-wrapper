/** Deleting a task from its header: gone everywhere on success, nothing lost on failure. Real React, Radix and QueryClient in a browser. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { hookBrowser, requestCount, settled } from '../sessions/cache-hooks-browser.mjs';

let browser;
before(async () => {
  browser = await hookBrowser('tests/chat/task-delete-fixture.mjs', {
    '@/components/providers/app-providers': `
      export const useOrganizationId = () => 'workspace';
      export const useViewer = () => ({ id: 'user' });`,
    sonner: 'export const toast = { error: (message) => window.harness.toasts.push(message) };',
    'next/navigation':
      'export const useRouter = () => ({ push: (path) => window.harness.paths.push(path) });',
    'next/link': `import React from 'react';
      export default (props) => React.createElement('a', props);`,
    '@/components/layouts/mobile-nav': 'export const MobileNavButton = () => null;',
    '@/features/overlays':
      'export const buildOverlayHash = () => ""; export const openOverlay = () => {};',
    './share-menu': 'export const ShareMenu = () => null; export const ShareSubmenu = () => null;',
    '@/features/realtime/hooks/use-workspace-channel':
      'export const useWorkspaceChannel = () => {};',
    '../api/load-chat-context': 'export const loadChatContext = async () => ({ session: null });',
  });
});
after(async () => {
  await browser?.close();
});

async function deleteFromHeader(page) {
  await page.click('[data-testid="task-menu"]');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await requestCount(page, 1);
  return page.evaluate(() => window.harness.requests[0]);
}

test('a deleted task leaves the sidebar and takes its draft with it', async (t) => {
  const page = await browser.page(t);
  const request = await deleteFromHeader(page);
  assert.equal(request.url, '/api/sessions/a');
  assert.equal(request.method, 'DELETE');
  assert.equal(await page.evaluate(() => window.harness.draft()), 'Keep my text');
  await page.evaluate(() => window.harness.respond(0, 204));
  await settled(page);
  await page.waitForFunction(() => window.harness.paths.length === 1);
  assert.deepEqual(await page.evaluate(() => window.harness.rows().map((row) => row.id)), ['b']);
  assert.deepEqual(await page.evaluate(() => window.harness.paths), ['/app']);
  assert.equal(await page.evaluate(() => window.harness.draft()), '');
  assert.equal(await page.evaluate(() => window.harness.takePicks()), undefined);
});

test('a failed delete keeps the task, its draft and its picks', async (t) => {
  const page = await browser.page(t);
  await deleteFromHeader(page);
  await page.evaluate(() => window.harness.respond(0, 500));
  await settled(page);
  assert.deepEqual(await page.evaluate(() => window.harness.rows().map((row) => row.id)), [
    'a',
    'b',
  ]);
  assert.deepEqual(await page.evaluate(() => window.harness.paths), []);
  assert.equal(await page.evaluate(() => window.harness.draft()), 'Keep my text');
  assert.equal(await page.evaluate(() => window.harness.takePicks()?.library.length), 1);
  assert.equal(await page.evaluate(() => window.harness.toasts.length), 1);
});
