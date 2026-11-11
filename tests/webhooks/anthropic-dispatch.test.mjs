// Routing Anthropic webhooks: each event runs its handlers in an order that never skips billing or loses a retry.
// The handlers themselves run against Postgres in tests/integration/anthropic-idle-webhook.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebhookError } from '../../src/lib/errors.ts';
import { loadTsx } from '../support/load-tsx.mjs';

function dispatchAnthropicEvent(event, services) {
  const { routeAnthropicEvent } = loadTsx(
    'src/features/webhooks/anthropic-dispatch.ts',
    () => services,
  );
  return routeAnthropicEvent(event);
}

function event(type, data = {}) {
  return {
    id: `evt_${type}`,
    created_at: '2026-08-18T12:00:00.000Z',
    type: 'event',
    data: {
      type,
      id: `resource_${type}`,
      organization_id: 'anthropic_org',
      workspace_id: 'anthropic_workspace',
      ...data,
    },
  };
}

function harness() {
  const calls = [];
  const called =
    (name, result) =>
    async (...args) => {
      calls.push([name, ...args]);
      return result;
    };
  return {
    calls,
    deps: {
      WebhookError,
      extend: (value) => calls.push(['extend', value]),
      shipLog: (value) => calls.push(['shipLog', value]),
      captureException: (error, extra) => calls.push(['captureException', error, extra]),
      adoptTaskRunBySessionId: called('adoptTaskRunBySessionId', { adopted: true }),
      completeTaskRun: called('completeTaskRun', { taskId: 'task_1' }),
      syncSessionStatus: called('syncSessionStatus', {
        status: 'idle',
        stopReason: 'end_turn',
      }),
      reconcileSessionUsage: called('reconcileSessionUsage'),
      dispatchSessionActions: called('dispatchSessionActions'),
      sweepSessionArtifacts: called('sweepSessionArtifacts'),
      completeDeploymentRunFailure: called('completeDeploymentRunFailure'),
      recordTaskRunReview: called('recordTaskRunReview', {
        handled: true,
        reviewOutcome: 'passed',
      }),
      mirrorDeploymentState: called('mirrorDeploymentState'),
      notifyVaultCredentialRefreshFailed: called('notifyVaultCredentialRefreshFailed'),
      pauseSessionForBudgetReached: called('pauseSessionForBudgetReached'),
    },
  };
}

function downstreamNames(calls) {
  return calls
    .map(([name]) => name)
    .filter((name) => name !== 'extend' && name !== 'shipLog' && name !== 'captureException');
}

test('every provider event we handle reaches its handlers, and nothing else runs', async () => {
  const cases = [
    ['session.status_run_started', ['adoptTaskRunBySessionId']],
    [
      'session.status_idled',
      [
        'adoptTaskRunBySessionId',
        'syncSessionStatus',
        'completeTaskRun',
        'reconcileSessionUsage',
        'sweepSessionArtifacts',
      ],
    ],
    [
      'session.status_terminated',
      ['adoptTaskRunBySessionId', 'completeTaskRun', 'syncSessionStatus', 'reconcileSessionUsage'],
    ],
    ['session.outcome_evaluation_ended', ['recordTaskRunReview']],
    ['deployment_run.failed', ['completeDeploymentRunFailure']],
    ['deployment.paused', ['mirrorDeploymentState']],
    ['deployment.unpaused', ['mirrorDeploymentState']],
    ['vault_credential.refresh_failed', ['notifyVaultCredentialRefreshFailed']],
    ['session.budget_reached', ['adoptTaskRunBySessionId', 'pauseSessionForBudgetReached']],
  ];

  for (const [type, expected] of cases) {
    const { calls, deps } = harness();
    await dispatchAnthropicEvent(
      event(type, type === 'vault_credential.refresh_failed' ? { vault_id: 'vault_1' } : {}),
      deps,
    );
    assert.deepEqual(downstreamNames(calls), expected, type);
  }
});

test('a failed status lookup fails the delivery for a retry before anything is billed', async () => {
  const { calls, deps } = harness();
  const failure = new Error('Stop reason lookup failed');
  deps.syncSessionStatus = async () => {
    throw failure;
  };
  await assert.rejects(dispatchAnthropicEvent(event('session.status_idled'), deps), failure);
  assert.deepEqual(downstreamNames(calls), ['adoptTaskRunBySessionId']);
  assert.equal(
    calls.some(([name]) => name === 'captureException'),
    false,
  );
});

test('a run waiting for approval is not finished, and an interrupted or exhausted turn finishes as stopped', async () => {
  for (const [status, stopReason, expected] of [
    ['requires_input', 'requires_action', null],
    ['idle', 'interrupted', 'terminated'],
    ['idle', 'retries_exhausted', 'terminated'],
  ]) {
    const { calls, deps } = harness();
    deps.syncSessionStatus = async () => ({ status, stopReason });
    await dispatchAnthropicEvent(event('session.status_idled'), deps);
    assert.equal(
      calls.some(([name]) => name === 'dispatchSessionActions'),
      stopReason === 'requires_action',
    );
    const completion = calls.find(([name]) => name === 'completeTaskRun');
    assert.equal(completion?.[1].outcome ?? null, expected);
  }
});

test('a billing failure still lets a terminated run finish, and fails the delivery for a retry', async () => {
  const { calls, deps } = harness();
  const failure = new Error('Billing unavailable');
  deps.reconcileSessionUsage = async () => {
    throw failure;
  };
  await assert.rejects(dispatchAnthropicEvent(event('session.status_terminated'), deps), failure);
  assert.deepEqual(downstreamNames(calls), [
    'adoptTaskRunBySessionId',
    'completeTaskRun',
    'syncSessionStatus',
  ]);
});

test('a tool delivery failure still bills the turn and recovers its files', async () => {
  const { calls, deps } = harness();
  deps.syncSessionStatus = async () => ({
    status: 'requires_input',
    stopReason: 'requires_action',
  });
  deps.dispatchSessionActions = async () => {
    throw new Error('delivery pending');
  };
  await assert.rejects(dispatchAnthropicEvent(event('session.status_idled'), deps), (error) => {
    assert.deepEqual(error.context.failed, ['tools']);
    assert.match(error.cause.errors[0].message, /delivery pending/);
    return true;
  });
  assert.ok(downstreamNames(calls).includes('reconcileSessionUsage'));
  assert.ok(downstreamNames(calls).includes('sweepSessionArtifacts'));
});
