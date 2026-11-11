/** Isolated headless browser for hook tests. No app server, login or real services. */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const defaultStubs = {
  '@/components/providers/app-providers': 'export const useOrganizationId = () => "workspace";',
  '@/lib/observability-client': 'export const captureException = () => {};',
  sonner: 'export const toast = { error: () => {} };',
};
const escape = (path) => path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// `stubs` maps an import specifier to the module source that replaces it.
export async function hookBrowser(entry = 'tests/sessions/cache-hooks-fixture.mjs', stubs = {}) {
  const boundaries = { ...defaultStubs, ...stubs };
  const bundle = await build({
    absWorkingDir: fileURLToPath(new URL('../..', import.meta.url)),
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    plugins: [
      {
        name: 'external-boundaries',
        setup(build) {
          build.onResolve(
            { filter: new RegExp(`^(${Object.keys(boundaries).map(escape).join('|')})$`) },
            ({ path }) => ({ path, namespace: 'boundary' }),
          );
          build.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
            contents: boundaries[path],
            resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({ headless: true });
  return {
    close: () => browser.close(),
    async page(t) {
      const page = await browser.newPage();
      t.after(() => page.close());
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      return page;
    },
  };
}
export async function requestCount(page, count) {
  await page.waitForFunction((n) => window.harness.requests.length === n, count);
}
export async function settled(page, pending = 0) {
  await page.waitForFunction((n) => window.harness.client.isMutating() === n, pending);
}
