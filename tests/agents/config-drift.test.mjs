// The admin drift page: the real drift reader and Anthropic client, with HTTP replaced at the edge.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSeedPlan } from '../../src/features/agent-setup/seed-plan.ts';
import { NATIVE_PROVIDERS } from '../fixtures/web-capabilities.mjs';

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters',
  GOOGLE_CLIENT_ID: 'test',
  GOOGLE_CLIENT_SECRET: 'test',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  ANTHROPIC_API_KEY: 'test-key',
  ANTHROPIC_ENVIRONMENT_ID: 'env_test',
  ANTHROPIC_AGENT_ID_FAST: 'agent_fast',
  ANTHROPIC_AGENT_ID_DEFAULT: 'agent_default',
  ANTHROPIC_AGENT_ID_PRO: 'agent_pro',
});
for (const key of ['EXA_API_KEY', 'BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID', 'MCP_PROXY_URL'])
  delete process.env[key];
const { getTierConfigDrift } = await import('../../src/features/agent-setup/api/prompt-drift.ts');
test('the drift page reports in sync when live matches the seed, and names the field that drifted', async () => {
  const plan = buildSeedPlan({ deployEnv: 'comparison', capabilities: NATIVE_PROVIDERS });
  const calls = [];
  let drifted = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = new URL(typeof request === 'string' ? request : request.url);
    calls.push(url.pathname);
    if (url.pathname.includes('/environments/'))
      return Response.json({
        id: 'env_test',
        config: drifted
          ? { type: 'cloud', networking: { type: 'limited' } }
          : plan.environment.config,
      });
    const agent = plan.agents.find((agent) => url.pathname.endsWith(`agent_${agent.slug}`));
    assert.ok(agent, `Unexpected request: ${url.pathname}`);
    return Response.json({
      ...agent,
      id: `agent_${agent.slug}`,
      version: 1,
      model: { id: agent.model },
      multiagent: {
        type: 'coordinator',
        agents: [{ type: 'agent', id: `agent_${agent.slug}`, version: 1 }],
      },
    });
  };
  try {
    const synced = await getTierConfigDrift();
    assert.deepEqual(
      synced.map(({ state }) => state.kind),
      ['in-sync', 'in-sync', 'in-sync'],
    );
    assert.equal(calls.filter((path) => path.includes('/environments/')).length, 1);
    drifted = true;
    const changed = await getTierConfigDrift();
    for (const { state } of changed) {
      assert.equal(state.kind, 'drifted');
      assert.deepEqual(state.fields, ['environment.networking.type']);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
