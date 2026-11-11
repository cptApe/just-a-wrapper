// How charges draw on credit grants: welcome credits, debt left by a charge past zero, and its repayment.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  balanceAt,
  creditBalanceProjection,
  seedCreditBalance,
  withLockedLedger,
} from './helpers/billing-ledger';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

// The shipped welcome grant is 0; a positive amount is the only way to exercise the grant path.
vi.mock('@/features/billing/pricing-config', async (actual) =>
  (await import('./helpers/seams')).pricingWith(actual, { WELCOME_CREDITS: 100 }),
);
vi.mock('next/server', () => ({ after: () => {} }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('@/features/agents/api/anthropic-client', () => {
  const client = () => ({ beta: { sessions: { events: { send: vi.fn(async () => {}) } } } });
  return { getAnthropicClient: client, requireAnthropicClient: client };
});

const { accrueModelRequest } = await import('@/features/billing/api/accrue-model-request');
const { consumeWorkspaceCredits, getLiveCreditBalance, grantWelcomeCredits, issueCreditGrant } =
  await import('@/features/billing/api/credit-ledger');
const { grantProration } = await import('@/features/billing/api/grant-proration');
const { WELCOME_CREDITS } = await import('@/features/billing/pricing-config');

const pool = makeTestPool();
const db = makeTestDb(pool);
const ORG = 'org_credit_draw';
const USER = 'user_credit_draw';
const DAY_MS = 86_400_000;
const FAR_FUTURE = new Date('2100-01-01T12:00:00.000Z');

let workspaceId: string;

beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  await seedOrganization(db, ORG);
  await seedUser(db, USER);
  workspaceId = randomUUID();
  await db.execute(sql`insert into workspace (id, organization_id, name)
    values (${workspaceId}, ${ORG}, 'Credit draw')`);
});

async function balance(): Promise<number> {
  const { rows } = await db.execute<{ credit_balance: number }>(
    sql`select ${creditBalanceProjection} from workspace where id = ${workspaceId}`,
  );
  return requiredRow(rows.at(0)).credit_balance;
}

function topUp(amount: number, sourceRef: string) {
  return withLockedLedger(db, workspaceId, (ledger) =>
    issueCreditGrant(ledger, {
      source: 'topup',
      sourceRef,
      amount,
      issuedAt: 'now',
      expiresAt: new Date('2099-01-01T12:00:00.000Z'),
    }),
  );
}

describe('welcome credits', () => {
  test('reading a balance never mints credits', async () => {
    expect(await getLiveCreditBalance(workspaceId)).toBe(0);
    const { rows } = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from credit_grant where workspace_id = ${workspaceId}`,
    );
    expect(requiredRow(rows.at(0)).count).toBe(0);
  });

  test('a retried provision grants welcome credits once, and they are spendable without a plan', async () => {
    await db.execute(
      sql`insert into session (workspace_memory_access, id, workspace_id, tier, created_by_user_id, kind, status, anthropic_session_id)
          values ('read_write', ${randomUUID()}, ${workspaceId}, 'default', ${USER}, 'chat', 'running', 'asess_welcome')`,
    );
    const grant = () =>
      db.transaction((tx) => grantWelcomeCredits(tx, { workspaceId, userId: USER }));
    expect(await grant()).toBe(true);
    expect(await grant()).toBe(false);

    await accrueModelRequest({
      anthropicSessionId: 'asess_welcome',
      anthropicEventId: 'sevt_welcome_spend',
      usage: { inputTokens: 1_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
    });

    expect(await balance()).toBe(WELCOME_CREDITS - 1);
    const { rows } = await db.execute(
      sql`select amount, consumed, source_ref from credit_grant
          where workspace_id = ${workspaceId} and source = 'welcome'`,
    );
    expect(rows).toEqual([{ amount: WELCOME_CREDITS, consumed: 1, source_ref: `welcome:${USER}` }]);
  });
});

describe('debt left by a charge past zero', () => {
  test.each([
    { debt: 150, grant: 100, after: -50, afterExpiry: -50 },
    { debt: 50, grant: 100, after: 50, afterExpiry: 0 },
  ])('a $grant-credit grant on $debt of debt leaves $after, and expiry never forgives debt', async ({
    debt,
    grant,
    after,
    afterExpiry,
  }) => {
    await seedCreditBalance(db, workspaceId, -debt);
    await topUp(grant, `stripe:pi_debt_${debt}`);

    expect(await balance()).toBe(after);
    expect(await getLiveCreditBalance(workspaceId)).toBe(after);
    expect(await balanceAt(db, workspaceId, FAR_FUTURE)).toBe(afterExpiry);
  });

  test('a welcome grant repays debt without forgiving the remainder', async () => {
    await seedCreditBalance(db, workspaceId, -(WELCOME_CREDITS + 2));
    await db.transaction((tx) => grantWelcomeCredits(tx, { workspaceId, userId: USER }));
    expect(await getLiveCreditBalance(workspaceId)).toBe(-2);
  });

  test('the ledger refuses a debt row that would mint positive credits', async () => {
    await expect(
      db.execute(
        sql`insert into credit_grant (workspace_id, source, source_ref, amount, consumed, issued_at, expires_at)
            values (${workspaceId}, 'debt', 'debt:invalid-positive', 10, 0, now(), '9999-12-31')`,
      ),
    ).rejects.toThrow();
  });

  test('an active yearly bucket repays old debt once, leaving next month untouched', async () => {
    await seedCreditBalance(db, workspaceId, -50);
    const nextMonth = new Date(Date.now() + 30 * DAY_MS);
    await db.execute(sql`insert into credit_grant (workspace_id, source, source_ref, amount, issued_at, expires_at)
      values (${workspaceId}, 'plan', 'second-month', 1000, now() - interval '1 day', ${nextMonth}),
             (${workspaceId}, 'plan', 'third-month', 1000, ${nextMonth}, ${new Date(nextMonth.getTime() + 30 * DAY_MS)})`);

    await db.transaction((tx) => consumeWorkspaceCredits(tx, { workspaceId, credits: 950 }));

    expect(await getLiveCreditBalance(workspaceId)).toBe(0);
    expect(await balanceAt(db, workspaceId, nextMonth)).toBe(1000);
  });

  test('a proration replaces a future bucket that was already fully consumed', async () => {
    const later = new Date(Date.now() + 30 * DAY_MS);
    await db.execute(sql`insert into credit_grant (workspace_id, source, source_ref, amount, consumed, issued_at, expires_at)
      values (${workspaceId}, 'plan', 'future', 100, 100, ${later}, ${new Date(later.getTime() + 30 * DAY_MS)})`);

    await withLockedLedger(db, workspaceId, (ledger) =>
      grantProration(ledger, {
        invoiceId: 'upgrade',
        paidCents: 100,
        interval: 'year',
        expiryMonths: 1,
      }),
    );

    const { rows } = await db.execute(
      sql`select amount from credit_grant where workspace_id = ${workspaceId}
          and source_ref = 'plan-invoice:upgrade:1' and status = 'issued'`,
    );
    expect(rows).toHaveLength(1);
  });
});
