/** What the seed pushes to Anthropic: what every agent may do without asking, where its sandbox
 * may connect, and what its prompt says it can do. Which tools each provider mix declares is
 * in tests/tools/tool-availability.test.mjs. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSeedPlan, buildSeedPlanFromEnv } from '../../src/features/agent-setup/seed-plan.ts';
import { composeSystemPrompt } from '../../src/features/agent-setup/system-prompts.ts';
import { CAPABILITY_OFF_MESSAGES } from '../../src/lib/capability-messages.ts';
import {
  NATIVE_PROVIDERS,
  PAID_PROVIDERS,
  WEB_COMBINATIONS,
} from '../fixtures/web-capabilities.mjs';

const plan = (extra = {}) =>
  buildSeedPlan({ capabilities: PAID_PROVIDERS, deployEnv: 'prod', ...extra });

test('built-in tools run without asking inside the sandbox, with the native web tools off', () => {
  for (const agent of plan().agents) {
    const toolset = agent.tools.find((tool) => tool.type === 'agent_toolset_20260401');
    assert.deepEqual(toolset.default_config, { permission_policy: { type: 'always_allow' } });
    assert.deepEqual(toolset.configs, [
      { name: 'web_search', enabled: false },
      { name: 'web_fetch', enabled: false },
    ]);
    assert.deepEqual(agent.mcp_servers, []);
  }
});

test('the sandbox reaches only Anthropic and our MCP proxy, with no package installs', () => {
  const networking = plan({ mcpProxyUrl: 'https://proxy.example.com/mcp' }).environment.config
    .networking;
  assert.equal(networking.type, 'limited');
  assert.equal(networking.allow_package_managers, false);
  assert.ok(networking.allowed_hosts.includes('api.anthropic.com'));
  assert.ok(networking.allowed_hosts.includes('proxy.example.com'));
  assert.ok(plan().warnings.some((warning) => warning.includes('MCP_PROXY_URL is not set')));
});

test('a preview seed never overwrites the production agents or environment', () => {
  const preview = buildSeedPlan({ capabilities: PAID_PROVIDERS, deployEnv: 'preview' });
  const production = buildSeedPlan({ capabilities: PAID_PROVIDERS, deployEnv: 'production' });
  assert.notEqual(preview.environment.name, production.environment.name);
  for (const [index, agent] of preview.agents.entries()) {
    assert.notEqual(agent.name, production.agents[index].name);
  }
});

test('the prompt names only the tools this deployment has, and says why a missing one is off', () => {
  for (const capabilities of Object.values(WEB_COMBINATIONS)) {
    const prompt = composeSystemPrompt(capabilities);
    assert.equal(prompt.includes('web_search_exa'), capabilities.webSearch.kind === 'exa');
    assert.equal(prompt.includes('browse_open'), capabilities.browser.kind === 'browserbase');
    assert.equal(
      prompt.includes('/opt/pw-browsers/chromium'),
      capabilities.browser.kind === 'sandbox',
    );
    assert.doesNotMatch(prompt, /\$\{/);
  }
  const off = composeSystemPrompt({ ...NATIVE_PROVIDERS, connectedApps: { kind: 'off' } });
  assert.match(off, /AI_GATEWAY_API_KEY/);
  assert.match(off, /COMPOSIO_API_KEY/);
});

// The seed script and the drift page both plan from environment values; if they read them
// differently, every deployment with connected apps reads as drifted.
test('a deployment with connected apps configured is seeded as having them', () => {
  const env = {
    COMPOSIO_API_KEY: 'ck_test',
    MCP_PROXY_URL: 'https://proxy.example.com/mcp',
    MCP_PROXY_JWT_SECRET: 'jwt-secret',
  };
  for (const agent of buildSeedPlanFromEnv(env, 'comparison').agents) {
    assert.ok(!agent.system.includes(CAPABILITY_OFF_MESSAGES.connectedApps));
  }
  assert.ok(
    buildSeedPlanFromEnv({}, 'comparison').agents[0].system.includes(
      CAPABILITY_OFF_MESSAGES.connectedApps,
    ),
  );
});
