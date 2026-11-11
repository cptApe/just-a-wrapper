import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffAgent, diffEnvironment } from '../../src/features/agent-setup/lib/seed-diff.ts';

// The seed updates an agent only when this diff is not empty. The live API echoes back more
// than we send (model as an object, resolved tool config, a packages block), so a naive
// compare would bump every agent's version on every re-run, and a missed field would leave
// production on an old prompt, old tools or looser permissions.

function liveAgent(overrides = {}) {
  return {
    id: 'agent_01abc',
    type: 'agent',
    name: 'just-a-wrapper-default-local',
    model: { id: 'claude-sonnet-4-6', speed: 'standard' },
    system: 'You are the default agent.',
    description: 'A copy of this agent for work it hands off.',
    tools: [
      {
        type: 'agent_toolset_20260401',
        configs: [],
        default_config: { permission_policy: { type: 'always_allow' } },
      },
    ],
    skills: [],
    mcp_servers: [],
    multiagent: { type: 'coordinator', agents: [{ type: 'agent', id: 'agent_01abc', version: 7 }] },
    metadata: {},
    version: 7,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

const desiredAgent = {
  description: 'A copy of this agent for work it hands off.',
  model: 'claude-sonnet-4-6',
  system: 'You are the default agent.',
  tools: [{ type: 'agent_toolset_20260401' }],
  mcp_servers: [],
  multiagent: { type: 'coordinator', agents: [{ type: 'self' }] },
};

const fields = (diffs) => diffs.map((diff) => diff.field).sort();

test('re-seeding an unchanged agent changes nothing, whatever extra fields the API echoes', () => {
  assert.deepEqual(diffAgent(desiredAgent, liveAgent()), []);
  const helpers = [
    { type: 'agent', id: 'agent_other', version: 3 },
    { type: 'agent', id: 'agent_helper', version: 2 },
  ];
  assert.deepEqual(
    diffAgent(
      { ...desiredAgent, multiagent: { type: 'coordinator', agents: helpers } },
      liveAgent({ multiagent: { type: 'coordinator', agents: [...helpers].reverse() } }),
    ),
    [],
  );
});

test('a changed model, prompt, toolset, MCP server or helper roster is pushed on re-seed', () => {
  for (const [live, expected] of [
    [{ model: { id: 'claude-opus-4-8' }, system: 'changed' }, ['model', 'system']],
    [{ system: null }, ['system']],
    [{ description: 'Something else' }, ['description']],
    [{ tools: [{ type: 'some_other_toolset', default_config: {} }] }, ['tools']],
    [{ mcp_servers: [{ type: 'url', url: 'https://proxy/mcp', name: 'proxy' }] }, ['mcp_servers']],
    // A self roster pinned behind the agent's own version runs an old copy for handed-off work.
    [{ version: 8 }, ['multiagent']],
  ]) {
    assert.deepEqual(fields(diffAgent(desiredAgent, liveAgent(live))), expected);
  }
  assert.deepEqual(fields(diffAgent({ ...desiredAgent, multiagent: null }, liveAgent())), [
    'multiagent',
  ]);
});

test('a built-in tool that asks in the seed but runs freely live is pushed on re-seed', () => {
  const toolset = {
    type: 'agent_toolset_20260401',
    default_config: { permission_policy: { type: 'always_allow' } },
    configs: [
      { name: 'web_search', enabled: false },
      { name: 'bash', permission_policy: { type: 'always_ask' } },
      { name: 'read', permission_policy: { type: 'always_allow' } },
    ],
  };
  const desired = { ...desiredAgent, tools: [toolset] };
  assert.deepEqual(fields(diffAgent(desired, liveAgent())), ['builtin_tool_policies']);
  assert.deepEqual(diffAgent(desired, liveAgent({ tools: [structuredClone(toolset)] })), []);
});

test('a custom tool whose name, description or input schema changed is pushed on re-seed', () => {
  const tool = {
    type: 'custom',
    name: 'fetch_page',
    description: 'Read a page',
    input_schema: { type: 'object', properties: { url: { type: 'string' } } },
  };
  const desired = { ...desiredAgent, tools: [...desiredAgent.tools, tool] };
  const live = (custom) => liveAgent({ tools: [...liveAgent().tools, custom] });
  assert.deepEqual(diffAgent(desired, live({ ...tool, server_metadata: 'ignored' })), []);
  assert.deepEqual(
    diffAgent(
      desired,
      live({ ...tool, input_schema: { properties: { url: { type: 'string' } }, type: 'object' } }),
    ),
    [],
  );
  for (const change of [
    { name: 'other_name' },
    { description: 'Another description' },
    { input_schema: { type: 'object', properties: { urls: { type: 'array' } } } },
  ]) {
    assert.deepEqual(fields(diffAgent(desired, live({ ...tool, ...change }))), ['custom_tools']);
  }
});

test('a sandbox whose network allow-list or flags drifted is pushed on re-seed', () => {
  const desired = {
    type: 'cloud',
    networking: {
      type: 'limited',
      allowed_hosts: ['api.anthropic.com', 'proxy.example.com'],
      allow_mcp_servers: true,
      allow_package_managers: false,
    },
  };
  const live = (networking) => ({
    type: 'cloud',
    networking: { ...desired.networking, ...networking },
    packages: { apt: [], cargo: [], gem: [], go: [], npm: [], pip: [], type: 'packages' },
  });
  assert.deepEqual(
    diffEnvironment(desired, live({ allowed_hosts: ['proxy.example.com', 'api.anthropic.com'] })),
    [],
  );
  for (const [networking, expected] of [
    [{ allowed_hosts: ['api.anthropic.com', 'unexpected.example'] }, 'networking.allowed_hosts'],
    [{ allow_package_managers: true }, 'networking.allow_package_managers'],
  ]) {
    assert.deepEqual(fields(diffEnvironment(desired, live(networking))), [expected]);
  }
  assert.deepEqual(
    fields(diffEnvironment(desired, { type: 'cloud', networking: { type: 'unrestricted' } })),
    ['networking.type'],
  );
});
