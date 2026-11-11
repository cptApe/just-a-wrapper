// Tool approvals: an outage never counts as a decision, and only unanswered gates are reapplied.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as resolve from '../../src/features/permissions/lib/resolve.ts';
import * as stall from '../../src/features/sessions/api/stream-stall.ts';
import { collectUnresolvedGates } from '../../src/features/sessions/lib/relay-translator.ts';
import * as events from '../../src/features/sessions/lib/tool-events.ts';
import { loadTsx } from '../support/load-tsx.mjs';

const { applyGatePolicy } = loadTsx(
  'src/features/session-runtime/api/apply-gate-policy.ts',
  (name) => {
    if (name === 'server-only') return {};
    if (name === '@/lib/observability') return { captureException() {} };
    if (name === '@/features/sessions/lib/tool-events') return events;
    if (name === '@/features/sessions/api/stream-stall') return stall;
    if (name === '@/features/permissions/lib/resolve') return resolve;
    throw new Error(`Unexpected dependency: ${name}`);
  },
);
const gate = { toolUseId: 'gate', toolName: 'bash', toolInput: {} };
const unavailable = async () => {
  throw new Error('unavailable');
};
const client = (send, list) => ({ beta: { sessions: { events: { send, list } } } });

test('a policy outage is retried, never treated as the person’s decision', async () => {
  assert.equal(
    await applyGatePolicy(client(unavailable, unavailable), 'session', gate, unavailable),
    'retry',
  );
  assert.equal(
    await applyGatePolicy(client(unavailable, unavailable), 'session', gate, async () => 'gate'),
    'gate',
  );
});

test('a confirmation that failed to send stays retryable unless the provider already recorded one', async () => {
  for (const list of [async () => ({ data: [] }), unavailable])
    assert.equal(
      await applyGatePolicy(client(unavailable, list), 'session', gate, async () => 'allow'),
      'retry',
    );
  const recorded = async () => ({
    data: [{ type: 'user.tool_confirmation', tool_use_id: 'gate', result: 'deny' }],
  });
  assert.equal(
    await applyGatePolicy(client(unavailable, recorded), 'session', gate, async () => 'allow'),
    'deny',
  );
});

test('only gates with no confirmation and no result are reapplied after a restart', () => {
  const ask = (id, type = 'agent.mcp_tool_use') => ({
    id,
    type,
    name: 'GMAIL_FETCH_EMAILS',
    mcp_server_name: 'composio',
    input: {},
    evaluated_permission: 'ask',
  });
  const history = [
    ask('answered'),
    { id: 'c1', type: 'user.tool_confirmation', tool_use_id: 'answered', result: 'allow' },
    ask('resulted'),
    { id: 'r2', type: 'agent.mcp_tool_result', mcp_tool_use_id: 'resulted', content: [] },
    ask('parked'),
    { ...ask('allowed', 'agent.tool_use'), evaluated_permission: 'allow' },
    ask('builtin', 'agent.tool_use'),
    { id: 'r5', type: 'agent.tool_result', tool_use_id: 'builtin', content: [] },
  ];
  assert.deepEqual(collectUnresolvedGates(history), [
    { toolUseId: 'parked', toolName: 'GMAIL_FETCH_EMAILS', toolInput: {} },
  ]);
});
