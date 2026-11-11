import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import '../support/env.mjs';

const require = createRequire(import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    // next's package exports have no extensionless entry for plain Node.
    if (specifier === 'next/navigation') return next('next/navigation.js', context);
    return next(specifier, context);
  },
});
const { createValidFileMatcher } = require('next/dist/server/lib/find-page-file');

function routes(root) {
  return readdirSync(root, { recursive: true })
    .filter((file) => /(?:page|route)\.dev\.tsx?$/.test(file))
    .map((file) => path.join(root, file));
}

test('a build serves dev routes only with the explicit flag, and Vercel never uploads them', async () => {
  const original = process.env.NEXT_PUBLIC_ENABLE_DEV_ROUTES;
  try {
    for (const enabled of ['false', 'true']) {
      process.env.NEXT_PUBLIC_ENABLE_DEV_ROUTES = enabled;
      const config = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '-e',
            `require('next/dist/server/config').default('phase-production-build', process.cwd()).then(c => process.stdout.write('EXTENSIONS:' + JSON.stringify({pageExtensions:c.pageExtensions})))`,
          ],
          { encoding: 'utf8', env: { ...process.env, NEXT_PUBLIC_ENABLE_DEV_ROUTES: enabled } },
        ).split('EXTENSIONS:')[1],
      );
      const matcher = createValidFileMatcher(config.pageExtensions, path.resolve('src/app'));
      const files = routes('src/app/api/dev');
      assert.ok(files.length >= 1);
      for (const file of files)
        assert.equal(matcher.isAppRouterPage(file), enabled === 'true', file);
      assert.equal(matcher.isAppRouterPage('src/app/page.tsx'), true);
      assert.equal(matcher.isAppRouterPage('src/app/api/health/route.ts'), true);
    }
    const ignore = readFileSync('.vercelignore', 'utf8').split('\n');
    assert.ok(ignore.includes('src/app/api/dev/'));
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_ENABLE_DEV_ROUTES;
    else process.env.NEXT_PUBLIC_ENABLE_DEV_ROUTES = original;
  }
});
