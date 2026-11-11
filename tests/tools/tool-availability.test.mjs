/** Which tools a deployment offers: the agent, the dispatcher and the Tools page must agree,
 * or the agent calls a tool that cannot run, or a member sees a switch for nothing. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSeedPlan } from '../../src/features/agent-setup/seed-plan.ts';
import { builtinShelfCards } from '../../src/features/permissions/lib/builtin-shelf-search.ts';
import {
  CUSTOM_TOOL_NAMES,
  customToolDeclarations,
  isToolAvailable,
} from '../../src/features/tool-catalog/declarations.ts';
import { buildCustomToolRegistry } from '../../src/features/tools/custom-tool-registry.ts';
import { resolveCapabilities } from '../../src/lib/capabilities.ts';
import { WEB_COMBINATIONS } from '../fixtures/web-capabilities.mjs';

const MEDIA = { off: { kind: 'off' }, gateway: { kind: 'gateway', apiKey: 'fixture' } };

test('the agent, the dispatcher and the Tools page offer the same tools for every provider mix', () => {
  for (const [label, web] of Object.entries(WEB_COMBINATIONS)) {
    for (const [mediaKind, media] of Object.entries(MEDIA)) {
      const capabilities = { ...web, media };
      const where = `${label} + media ${mediaKind}`;
      const declared = new Set(customToolDeclarations(capabilities).map(({ name }) => name));
      const dispatchable = [...buildCustomToolRegistry(capabilities).keys()].sort();
      const shelf = builtinShelfCards(capabilities)
        .flatMap(({ abilities }) => abilities.map(({ custom }) => custom))
        .filter(Boolean);
      assert.deepEqual(dispatchable, [...declared].sort(), where);
      assert.deepEqual([...new Set(shelf)].sort(), [...declared].sort(), where);
      for (const name of CUSTOM_TOOL_NAMES)
        assert.equal(isToolAvailable(name, capabilities), declared.has(name), `${where}: ${name}`);
      assert.equal(declared.has('generate_image'), mediaKind === 'gateway', where);
      assert.equal(declared.has('web_search_exa'), web.webSearch.kind === 'exa', where);
      assert.equal(declared.has('browse_open'), web.browser.kind === 'browserbase', where);

      const plan = buildSeedPlan({ deployEnv: 'test', capabilities });
      for (const agent of plan.agents) {
        const custom = agent.tools.filter((tool) => tool.type === 'custom').map((t) => t.name);
        assert.deepEqual(new Set(custom), declared, where);
        const toolset = agent.tools.find((tool) => tool.type === 'agent_toolset_20260401');
        const nativeWeb = web.webSearch.kind === 'anthropic';
        assert.deepEqual(
          toolset.configs,
          ['web_search', 'web_fetch'].map((name) => ({ name, enabled: nativeWeb })),
          where,
        );
      }
    }
  }
});

test('the sandbox is locked to known hosts exactly when search and browsing run through our tools', () => {
  for (const [label, capabilities] of Object.entries(WEB_COMBINATIONS)) {
    const plan = buildSeedPlan({ deployEnv: 'test', capabilities });
    const metered =
      capabilities.webSearch.kind === 'exa' && capabilities.browser.kind !== 'sandbox';
    assert.equal(
      plan.environment.config.networking.type,
      metered ? 'limited' : 'unrestricted',
      label,
    );
  }
});

test('billing and connected apps turn on only with their full configuration', () => {
  assert.deepEqual(resolveCapabilities({}).billing, { kind: 'off' });
  assert.equal(resolveCapabilities({ STRIPE_SECRET_KEY: 'sk_test' }).billing.kind, 'stripe');
  assert.deepEqual(resolveCapabilities({}).connectedApps, { kind: 'off' });
  const composio = {
    COMPOSIO_API_KEY: 'key',
    MCP_PROXY_URL: 'https://app.example.test/api/mcp/composio',
    MCP_PROXY_JWT_SECRET: 'secret',
  };
  assert.equal(resolveCapabilities(composio).connectedApps.kind, 'composio');
  for (const partial of [
    { ...composio, MCP_PROXY_URL: undefined },
    { ...composio, MCP_PROXY_JWT_SECRET: undefined },
    { BROWSERBASE_API_KEY: 'key' },
    { BROWSERBASE_PROJECT_ID: 'project' },
  ]) {
    assert.throws(() => resolveCapabilities(partial), { code: 'VALIDATION_FAILED' });
  }
});
