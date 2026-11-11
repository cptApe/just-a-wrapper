// The admin drift page on a deployment with no environment id; its own file because the
// environment is read once at import.
import assert from 'node:assert/strict';
import { test } from 'node:test';

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters',
  GOOGLE_CLIENT_ID: 'test',
  GOOGLE_CLIENT_SECRET: 'test',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
});
delete process.env.ANTHROPIC_ENVIRONMENT_ID;
delete process.env.BROWSERBASE_API_KEY;
delete process.env.BROWSERBASE_PROJECT_ID;
const { getTierConfigDrift } = await import('../../src/features/agent-setup/api/prompt-drift.ts');
test('without an environment id the drift page says unknown instead of a false drift alarm', async () => {
  const tiers = await getTierConfigDrift();
  assert.equal(tiers.length, 3);
  for (const { state } of tiers) {
    assert.equal(state.kind, 'unknown');
    assert.match(state.reason, /No ANTHROPIC_ENVIRONMENT_ID/);
  }
});
