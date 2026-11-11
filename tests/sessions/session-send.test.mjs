// Sending to the provider: a message is posted once, never retried blind, and the grounding fallback drops only the system note.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { sessionBudgetForCreditBalance } from '../../src/features/billing/lib/session-budget-value.ts';
import { tagClientSend } from '../../src/features/sessions/lib/client-send-tag.ts';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/lib/observability')
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const captureException=()=>{}',
      };
    return next(specifier, context);
  },
});
const { sendSessionEventsWithGroundingFallback } = await import(
  '../../src/features/sessions/api/send-session-events.ts'
);
const { createManagedChatSession } = await import(
  '../../src/features/sessions/api/create-managed-chat-session.ts'
);

const user = { type: 'user.message', content: [{ type: 'text', text: 'Hello' }] };
const system = { type: 'system.message', content: [{ type: 'text', text: 'Clock' }] };

function client(responses, maxRetries = 0) {
  const sent = [];
  return {
    sent,
    anthropic: new Anthropic({
      apiKey: 'unit-test',
      maxRetries,
      fetch: async (_url, options) => {
        sent.push(JSON.parse(options.body));
        return responses[Math.min(sent.length, responses.length) - 1]();
      },
    }),
  };
}
const refusal = (status, type) => () =>
  Response.json({ type: 'error', error: { type } }, { status });
const ok = () => Response.json({ data: [] });

test('only the “no mid-conversation system” refusal resends, without the system note', async () => {
  for (const [status, type, resends] of [
    [400, 'model_does_not_support_mid_conversation_system', true],
    [400, 'invalid_request_error', false],
    [409, 'model_does_not_support_mid_conversation_system', false],
  ]) {
    const { sent, anthropic } = client([refusal(status, type), ok]);
    const sending = sendSessionEventsWithGroundingFallback(anthropic, 'session', [user, system]);
    if (resends) {
      await sending;
      assert.deepEqual(sent, [{ events: [user, system] }, { events: [user] }]);
    } else {
      await assert.rejects(sending);
      assert.deepEqual(sent, [{ events: [user, system] }], `${status} ${type}`);
    }
  }
});

test('the grounding fallback never drops the person’s own message', async () => {
  const { sent, anthropic } = client([
    refusal(400, 'model_does_not_support_mid_conversation_system'),
  ]);
  await assert.rejects(sendSessionEventsWithGroundingFallback(anthropic, 'session', [user]));
  assert.equal(sent.length, 1);
});

test('an overloaded provider answer is not retried, so a message cannot be posted twice', async () => {
  for (const sendId of [undefined, '6554bd38-4cab-46b0-b9b1-8ddcc1b2354a']) {
    const busy = () =>
      Response.json(
        { error: { type: 'overloaded_error' } },
        { status: 529, headers: { 'retry-after-ms': '1' } },
      );
    const { sent, anthropic } = client([busy, ok], 1);
    const tagged = { ...user, content: [{ type: 'text', text: tagClientSend('Hello', sendId) }] };
    await assert.rejects(sendSessionEventsWithGroundingFallback(anthropic, 'session', [tagged]));
    assert.equal(sent.length, 1);
  }
});

test('creating a chat is one provider call with no retry, carrying its budget and owner', async () => {
  const calls = [];
  const sdk = {
    beta: {
      sessions: {
        async create(params, options) {
          calls.push({ params, options });
          return { id: 'sesn_upstream' };
        },
      },
    },
  };
  await createManagedChatSession(sdk, {
    agent: { type: 'agent_with_overrides', id: 'agent_default', skills: [] },
    environmentId: 'env_default',
    budget: sessionBudgetForCreditBalance(88, 0),
    title: 'Opening title',
    workspaceId: 'workspace_123',
    createdByUserId: 'user_123',
    taskId: null,
    appSessionId: '00000000-0000-4000-8000-000000000001',
    resources: [],
    vaultIds: [],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.maxRetries, 0);
  assert.deepEqual(calls[0].params.budget, {
    type: 'limit',
    max_list_cost: { amount: '88', currency: 'USD' },
  });
  assert.deepEqual(calls[0].params.metadata, {
    workspace_id: 'workspace_123',
    created_by_user_id: 'user_123',
    app_session_id: '00000000-0000-4000-8000-000000000001',
  });
  assert.equal('initial_events' in calls[0].params, false);
});

test('a session budget is the workspace credits, one credit per cent, never below one cent', () => {
  for (const [credits, consumed, amount] of [
    [400, 0, '400'],
    [88, 0, '88'],
    [500, 14, '514'],
    [0, 0, '1'],
    [-10, 0, '1'],
  ])
    assert.deepEqual(sessionBudgetForCreditBalance(credits, consumed), {
      type: 'limit',
      max_list_cost: { amount, currency: 'USD' },
    });
});
