// A purge dry run must not move money. Cron authentication is covered in
// tests/integration/billing-recovery.test.ts.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import '../support/env.mjs';

registerHooks({
  resolve(specifier, context, next) {
    const replacements = {
      '@/features/workspaces/server':
        'export async function runPurgeJobs() { return { report: {}, failed: false }; }',
      'next/server': 'export function after() {}',
      '@/features/jobs/server':
        'export async function runBillingRecovery() { globalThis.billingRuns++; }',
    };
    if (replacements[specifier])
      return {
        url: `data:text/javascript,${encodeURIComponent(replacements[specifier])}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
process.env.CRON_SECRET = 'test-secret';
const { GET: purge } = await import('../../src/app/api/cron/purge/route.ts');

test('a purge dry run never runs billing recovery, so it cannot charge or refund', async () => {
  globalThis.billingRuns = 0;
  const response = await purge(
    new Request('https://test/api/cron/purge?dryRun=true', {
      headers: { authorization: 'Bearer test-secret' },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(globalThis.billingRuns, 0);
});
