/** Real React and Radix in an isolated browser: expanding a preview keeps what is typed in it. */
import assert from 'node:assert/strict';
import { test } from '@playwright/test';
import { build } from 'esbuild';

test.use({ viewport: { width: 1000, height: 800 } });

test.beforeEach(async ({ page }) => {
  const bundle = await build({
    stdin: {
      contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { PreviewSurface } from './src/components/ui/preview-surface';
      let instances = 0;
      function Child() {
        const [instance] = useState(() => ++instances);
        return <input aria-label="Preview value" data-instance={instance} defaultValue="keep me" />;
      }
      function App() {
        return <><button id="outside">Outside</button>
        <PreviewSurface kind="file-preview" title="Preview" open onOpenChange={() => {}}><Child /></PreviewSurface></>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    `,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: {
      'process.env.NODE_ENV': '"test"',
      process: '{"env":{"NEXT_PUBLIC_APP_URL":"http://fixture.test"}}',
    },
  });
  await page.route('http://fixture.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>body{height:4000px}.fixed{position:fixed}.inset-0{inset:0}.z-dialog{z-index:50}[role="dialog"]{position:fixed;right:0;top:0;z-index:51}.bg-overlay{background:rgba(0,0,0,.6)}</style><div id="root"></div>',
    }),
  );
  await page.goto('http://fixture.test/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByLabel('Preview value').waitFor();
});

test('expanding and collapsing a preview keeps what the person typed in it', async ({ page }) => {
  const input = page.getByLabel('Preview value');
  const instance = await input.getAttribute('data-instance');
  await input.fill('edited');
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  assert.equal(await input.getAttribute('data-instance'), instance);
  assert.equal(await input.inputValue(), 'edited');
  await page.getByRole('button', { name: 'Collapse', exact: true }).click();
  assert.equal(await input.getAttribute('data-instance'), instance);
  assert.equal(await input.inputValue(), 'edited');
});

test('an expanded preview keeps keyboard focus inside it', async ({ page }) => {
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  assert.equal(await page.getByRole('dialog').getAttribute('aria-modal'), 'true');
  // A keyboard user tabs forward and back; focus never lands on the page behind the preview.
  for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    assert.equal(
      await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))),
      true,
      `focus left the preview after ${key}`,
    );
  }
});
