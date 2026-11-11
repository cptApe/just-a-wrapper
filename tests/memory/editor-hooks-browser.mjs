// Isolated hook tests use a headless browser without an app server or credentials.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

export async function editorHookBrowser() {
  const bundle = await build({
    absWorkingDir: fileURLToPath(new URL('../..', import.meta.url)),
    entryPoints: ['tests/memory/editor-hooks-fixture.mjs'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    // Next inlines NEXT_PUBLIC_* values in the browser; unset ones read as undefined here.
    define: { 'process.env': '{}' },
    plugins: [
      {
        name: 'external-boundaries',
        setup(build) {
          build.onResolve({ filter: /^@\/components\/ui\/markdown-message$/ }, ({ path }) => ({
            path,
            namespace: 'renderer',
          }));
          build.onLoad({ filter: /.*/, namespace: 'renderer' }, () => ({
            contents: 'export const MarkdownMessage = () => null;',
          }));
          build.onResolve(
            {
              filter:
                /^(next\/navigation|sonner|@\/components\/providers\/app-providers|@\/lib\/observability-client)$/,
            },
            ({ path }) => ({ path, namespace: 'boundary' }),
          );
          build.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
            const contents =
              path === 'sonner'
                ? 'export const toast = Object.fromEntries(["error","success","loading","dismiss"].map(kind => [kind, (...args) => window.harness.messages.push({kind, args})]));'
                : path === 'next/navigation'
                  ? 'export const useRouter = () => ({ push: path => window.harness.routes.push(path) });'
                  : path.includes('observability')
                    ? 'export const captureException = error => window.harness.captured.push(error.message);'
                    : 'export const useOrganizationId = () => "workspace"; export const useViewer = () => null;';
            return { contents };
          });
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
      await page.waitForFunction(() => window.harness.draft?.editor.kind === 'editing');
      return page;
    },
  };
}
