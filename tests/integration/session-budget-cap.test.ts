// The provider-side spending cap on each session and deployment follows the balance and the creator's allowance.
import { randomUUID } from 'node:crypto';
import { APIError } from '@anthropic-ai/sdk';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { creditBalanceProjection, seedCreditBalance } from './helpers/billing-ledger';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const provider = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown>,
  send: vi.fn(),
  list: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
  deploymentRetrieve: vi.fn(),
  deploymentUpdate: vi.fn(),
}));
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => provider.afterCallbacks.push(callback),
}));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('@/lib/observability', async (original) => ({
  ...(await original<typeof import('@/lib/observability')>()),
  captureException: vi.fn(),
}));
vi.mock('@/features/agents/api/anthropic-client', () => {
  const client = () => ({
    beta: {
      sessions: {
        retrieve: provider.retrieve,
        update: provider.update,
        events: { send: provider.send, list: provider.list },
      },
      deployments: { retrieve: provider.deploymentRetrieve, update: provider.deploymentUpdate },
    },
  });
  return { getAnthropicClient: client, requireAnthropicClient: client };
});

const { issueCreditGrant } = await import('@/features/billing/api/credit-ledger');
const { lockLedger } = await import('@/features/billing/api/ledger-lock');
const { sessionBudgetForWorkspace } = await import('@/features/billing/api/session-budget');
const { scheduleWorkspaceSessionBudgetsAfterGrant, syncWorkspaceSessionBudgetsAfterGrant } =
  await import('@/features/billing/api/sync-session-budgets');
const { sessionBudgetForCreditBalance } = await import(
  '@/features/billing/lib/session-budget-value'
);
const { sendMessageWithBudgetRecovery } = await import(
  '@/features/session-runtime/api/send-message-with-budget-recovery'
);
const { adoptTaskRunBySessionId } = await import('@/features/tasks/api/adopt-task-run');
const { withRequestContext } = await import('@/lib/request-context');

const pool = makeTestPool();
const db = makeTestDb(pool);
const ORG = 'org_budget_cap';
const USER = 'user_budget_cap';
const UPDATE_OPTIONS = { timeout: 30_000, maxRetries: 0 };
const cap = (amount: string) => ({
  budget: { type: 'limit', max_list_cost: { amount, currency: 'USD' } },
});

let workspaceId: string;

beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  provider.afterCallbacks.length = 0;
  provider.send.mockReset();
  provider.update.mockReset().mockResolvedValue({});
  provider.deploymentUpdate.mockReset().mockResolvedValue({});
  provider.deploymentRetrieve
    .mockReset()
    .mockResolvedValue({ status: 'active', archived_at: null, schedule: null });
  provider.retrieve.mockReset().mockResolvedValue({
    usage: { list_cost: { amount: '14', currency: 'USD' } },
    budget: cap('14').budget,
  });
  provider.list.mockReset().mockResolvedValue({
    data: [
      { id: 'status_budget', type: 'session.status_idle', stop_reason: { type: 'budget_reached' } },
    ],
  });
  await seedOrganization(db, ORG);
  await seedUser(db, USER);
  workspaceId = randomUUID();
  await db.execute(
    sql`insert into workspace (id, organization_id, name, plan_tier, stripe_subscription_id, plan_billing_interval, plan_credits)
        values (${workspaceId}, ${ORG}, 'Budget cap', 'pro', 'sub_cap', 'month', 1000)`,
  );
});

const inContext = <T>(run: () => Promise<T>) => withRequestContext({ route: 'test/budget' }, run);

async function flushAfterResponse(): Promise<void> {
  while (provider.afterCallbacks.length > 0)
    await Promise.all(provider.afterCallbacks.splice(0).map(async (callback) => callback()));
}

async function seedSession(
  status: string,
  opts: { kind?: 'chat' | 'task_run'; pausedReason?: string; id?: string } = {},
): Promise<{ anthropicSessionId: string; sessionRowId: string }> {
  const sessionRowId = randomUUID();
  const anthropicSessionId = opts.id ?? `asess_${sessionRowId}`;
  const paused = status === 'paused_no_credits';
  await db.execute(
    sql`insert into session (workspace_memory_access, id, workspace_id, tier, created_by_user_id, kind, status,
                             paused_at, paused_reason, anthropic_session_id)
        values ('read_write', ${sessionRowId}, ${workspaceId}, 'default', ${USER}, ${opts.kind ?? 'chat'}, ${status},
                ${paused ? new Date() : null}, ${opts.pausedReason ?? null}, ${anthropicSessionId})`,
  );
  return { anthropicSessionId, sessionRowId };
}

// The creator's allowance: `limit` credits this period, `used` of them spent.
async function limitCreator(limit: number, used: number) {
  await db.execute(sql`insert into workspace_member (organization_id, user_id, composio_user_id, credit_limit)
    values (${ORG}, ${USER}, 'budget-cap-member', ${limit})`);
  await db.execute(sql`insert into usage_event (workspace_id, user_id, event_type, credits_delta)
    values (${workspaceId}, ${USER}, 'model_request', ${-used})`);
}

async function seedTask(status = 'upcoming'): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`insert into task (id, workspace_id, created_by_user_id, title, description, status, trigger_type, cron_schedule, anthropic_deployment_id)
    values (${id}, ${workspaceId}, ${USER}, 'Task', 'Do work', ${status}, 'schedule', '0 9 * * *', ${`depl-${id}`})`);
  return id;
}

function providerRun(taskId: string, id: string) {
  return {
    id,
    resources: [],
    metadata: { task_id: taskId },
    deployment_id: `depl-${taskId}`,
    status: 'running',
    created_at: new Date().toISOString(),
    usage: { list_cost: { amount: '2', currency: 'USD' } },
    budget: { max_list_cost: { amount: '5000', currency: 'USD' } },
  };
}

// Grant paths commit first and refresh budgets after the response, so an outage cannot undo credits.
async function grant(amount: number, sourceRef: string) {
  const inserted = await db.transaction(async (tx) => {
    const ledger = await lockLedger(tx, workspaceId);
    if (!ledger) throw new Error('Missing workspace');
    return issueCreditGrant(ledger, {
      source: 'topup',
      sourceRef,
      amount,
      issuedAt: 'now',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  });
  await inContext(async () => scheduleWorkspaceSessionBudgetsAfterGrant(workspaceId));
  await flushAfterResponse();
  return inserted;
}

const budgetReached = () =>
  new APIError(
    400,
    {
      error: {
        type: 'invalid_request_error',
        message: 'user.message is not accepted; settle in-flight work first',
      },
    },
    undefined,
    new Headers(),
  );
const send = (anthropicSessionId: string) =>
  inContext(() =>
    sendMessageWithBudgetRecovery({
      workspaceId,
      sessionId: anthropicSessionId,
      text: 'Continue',
      origin: 'user',
    }),
  );

describe('the cap value', () => {
  test('a chat is capped at the balance, an unattended run at its creator remaining allowance', async () => {
    await seedCreditBalance(db, workspaceId, 500);
    await limitCreator(50, 10);
    await expect(sessionBudgetForWorkspace(workspaceId)).resolves.toEqual(
      sessionBudgetForCreditBalance(500, 0),
    );
    await expect(sessionBudgetForWorkspace(workspaceId, USER)).resolves.toEqual(
      sessionBudgetForCreditBalance(40, 0),
    );
  });
});

describe('a send that meets the cap', () => {
  test('a send refused at the cap raises the cap to spent plus balance and is retried once', async () => {
    await seedCreditBalance(db, workspaceId, 500);
    const { anthropicSessionId } = await seedSession('idle');
    provider.send.mockRejectedValueOnce(budgetReached()).mockResolvedValueOnce({
      data: [{ id: 'event_retry', type: 'user.message', processed_at: null }],
    });

    expect(await send(anthropicSessionId)).toEqual({ eventId: 'event_retry', processedAt: null });
    expect(provider.send).toHaveBeenCalledTimes(2);
    expect(provider.update).toHaveBeenCalledWith(anthropicSessionId, cap('514'), UPDATE_OPTIONS);
  });

  test('a session paused for credits has its cap raised before the first send attempt', async () => {
    await seedCreditBalance(db, workspaceId, 500);
    const { anthropicSessionId } = await seedSession('paused_no_credits', {
      pausedReason: 'credits',
    });
    provider.send.mockResolvedValue({
      data: [{ id: 'event_first_try', type: 'user.message', processed_at: null }],
    });

    expect(await send(anthropicSessionId)).not.toBeNull();
    expect(provider.send).toHaveBeenCalledOnce();
    const updateOrder = requiredRow(provider.update.mock.invocationCallOrder.at(0));
    expect(updateOrder).toBeLessThan(requiredRow(provider.send.mock.invocationCallOrder.at(0)));
  });

  test('a terminated session is not sent to or re-capped', async () => {
    await seedCreditBalance(db, workspaceId, 500);
    const { anthropicSessionId } = await seedSession('terminated');
    provider.send.mockRejectedValue(budgetReached());

    await expect(send(anthropicSessionId)).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(provider.send).not.toHaveBeenCalled();
    expect(provider.update).not.toHaveBeenCalled();
  });

  test('a member at their credit limit cannot get the cap raised by sending', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    const { anthropicSessionId } = await seedSession('paused_no_credits', {
      pausedReason: 'member_limit',
    });
    await limitCreator(0, 1);

    await expect(send(anthropicSessionId)).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    expect(provider.update).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  });
});

describe('a committed credit grant', () => {
  test('a session whose provider reports no list cost is capped at the new balance, not the old cap plus it', async () => {
    await seedCreditBalance(db, workspaceId, 14);
    const { anthropicSessionId } = await seedSession('running');
    provider.retrieve.mockResolvedValueOnce({
      budget: cap('14').budget,
      usage: {},
      status: 'running',
    });

    await grant(500, 'manual:missing-list-cost');

    expect(provider.update).toHaveBeenCalledWith(anthropicSessionId, cap('514'), UPDATE_OPTIONS);
  });

  test('a provider outage while raising caps never rolls back the committed grant', async () => {
    await seedCreditBalance(db, workspaceId, 14);
    await seedSession('running');
    provider.update.mockRejectedValueOnce(new Error('Anthropic unavailable'));

    await expect(grant(500, 'manual:update-failure')).resolves.toBe(true);

    const { rows } = await db.execute<{ credit_balance: number }>(
      sql`select ${creditBalanceProjection} from workspace where id = ${workspaceId}`,
    );
    expect(requiredRow(rows.at(0)).credit_balance).toBe(514);
  });

  test('a cap refresh that failed before its workspace existed does not block a later refresh', async () => {
    const lateWorkspaceId = randomUUID();
    await Promise.all([
      inContext(() => syncWorkspaceSessionBudgetsAfterGrant(lateWorkspaceId)),
      inContext(() => syncWorkspaceSessionBudgetsAfterGrant(lateWorkspaceId)),
    ]);
    await seedOrganization(db, 'org_late');
    await db.execute(sql`insert into workspace (id, organization_id, name)
      values (${lateWorkspaceId}, 'org_late', 'Late')`);
    workspaceId = lateWorkspaceId;
    await seedCreditBalance(db, workspaceId, 500);
    const { anthropicSessionId } = await seedSession('running');

    const result = await inContext(() => syncWorkspaceSessionBudgetsAfterGrant(workspaceId));

    expect(result.updatedSessionIds).toEqual([anthropicSessionId]);
    expect(provider.update).toHaveBeenCalledOnce();
  });

  test('a grant raises chat caps to the balance and leaves the run of an exhausted creator alone', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    await limitCreator(5, 5);
    await seedSession('running', { id: 'grant-chat' });
    await seedSession('running', { id: 'grant-run', kind: 'task_run' });
    provider.retrieve.mockResolvedValue({ usage: {} });

    const result = await inContext(() => syncWorkspaceSessionBudgetsAfterGrant(workspaceId));

    expect(result.updatedSessionIds).toEqual(['grant-chat']);
    expect(provider.update).toHaveBeenCalledWith('grant-chat', cap('100'), UPDATE_OPTIONS);
  });

  test('a grant raises deployment caps even with no session running', async () => {
    const taskId = await seedTask();
    await seedCreditBalance(db, workspaceId, 100);

    await inContext(() => syncWorkspaceSessionBudgetsAfterGrant(workspaceId));

    expect(provider.deploymentUpdate).toHaveBeenCalledWith(
      `depl-${taskId}`,
      cap('100'),
      UPDATE_OPTIONS,
    );
  });

  test('a finished one-off is skipped and a failing deployment does not stop session caps', async () => {
    const oneOff = await seedTask('running');
    await db.execute(
      sql`update task set run_at = now(), cron_schedule = null where id = ${oneOff}`,
    );
    await seedTask();
    await seedCreditBalance(db, workspaceId, 100);
    await seedSession('running', { id: 'running-budget' });
    provider.deploymentUpdate.mockRejectedValue(new Error('Unavailable'));
    provider.retrieve.mockResolvedValue({ usage: {} });

    const result = await inContext(() => syncWorkspaceSessionBudgetsAfterGrant(workspaceId));

    expect(provider.deploymentUpdate).toHaveBeenCalledTimes(1);
    expect(provider.deploymentUpdate.mock.calls[0]?.[0]).not.toBe(`depl-${oneOff}`);
    expect(result.updatedSessionIds).toContain('running-budget');
    expect(result.failedDeploymentIds).toHaveLength(1);
  });
});

describe('adopting a scheduled run', () => {
  test('an adopted run with a stale high cap is re-capped at spent plus balance', async () => {
    const taskId = await seedTask();
    await seedCreditBalance(db, workspaceId, 10);
    provider.retrieve.mockResolvedValue(providerRun(taskId, 'adopted-run'));

    await inContext(() => adoptTaskRunBySessionId('adopted-run'));

    expect(provider.update).toHaveBeenCalledWith('adopted-run', cap('12'), UPDATE_OPTIONS);
  });

  test("an adopted run is capped at its creator's remaining allowance, not the balance", async () => {
    const taskId = await seedTask();
    await seedCreditBalance(db, workspaceId, 1000);
    await limitCreator(50, 10);
    provider.retrieve.mockResolvedValue(providerRun(taskId, 'capped-run'));

    await inContext(() => adoptTaskRunBySessionId('capped-run'));

    // Two cents already spent plus the forty credits the creator has left.
    expect(provider.update).toHaveBeenCalledWith('capped-run', cap('42'), UPDATE_OPTIONS);
  });
});
