// `pnpm posthog:sync` charts the environment it is told, and refuses an unknown one before any
// network call. It runs with no API key, so an accepted value stops at credential validation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const ENVIRONMENT_ERROR = 'Environment must be development, preview, or production.';

function runSync(args) {
  return spawnSync(
    process.execPath,
    [
      '--import',
      './scripts/register-aliases.mjs',
      '--experimental-strip-types',
      'scripts/posthog-sync.ts',
      ...args,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        POSTHOG_API_KEY: '',
        POSTHOG_PROJECT_ID: '199193',
      },
    },
  );
}

test('the sync charts the named environment in either flag form and refuses an unknown one', () => {
  for (const args of [['--environment', 'production'], ['--environment=production']]) {
    const result = runSync(args);
    assert.match(result.stdout, /charting production events/, args.join(' '));
    assert.doesNotMatch(result.stderr, new RegExp(ENVIRONMENT_ERROR));
  }
  for (const args of [['--environment=staging'], ['--environment']]) {
    const result = runSync(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), ENVIRONMENT_ERROR);
  }
});
