// Plan limits and the sentence a refused person reads. The gates run on real rows and under
// concurrency in tests/integration/plan-limits*.test.ts, member-cap.test.ts and billing-off.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billingModeRules } from '../../src/features/billing/lib/billing-mode-rules.ts';
import {
  chatsAtOnceExceeded,
  chatsAtOnceMessage,
  membersAllowed,
  membersExceeded,
  membersMessage,
  scheduledTasksExceeded,
  scheduledTasksMessage,
  UNLIMITED_MEMBERS,
} from '../../src/features/billing/lib/plan-gates.ts';
import { NO_PLAN_LIMITS, PLANS } from '../../src/features/billing/pricing-config.ts';

const pro = PLANS.pro.limits;
const max = PLANS.max.limits;
const plain = (limits) => ({ limits, biggerPlan: false });

test('each gate refuses the item that would break the limit, not the one that reaches it', () => {
  assert.equal(chatsAtOnceExceeded(pro.chatsAtOnce - 1, pro), false);
  assert.equal(chatsAtOnceExceeded(pro.chatsAtOnce, pro), true);
  assert.equal(scheduledTasksExceeded(max.scheduledTasks - 1, max), false);
  assert.equal(scheduledTasksExceeded(max.scheduledTasks, max), true);
});

test('a pending invitation holds a seat, and a plan without a member limit never refuses', () => {
  // Pro seats five: four who joined and one waiting to accept is the whole plan.
  assert.equal(membersExceeded(4, 0, pro), false);
  assert.equal(membersExceeded(4, 1, pro), true);
  assert.equal(membersExceeded(0, 5, pro), true);
  assert.equal(max.members, null);
  assert.equal(membersExceeded(500, 500, max), false);
  assert.equal(membersAllowed(max), UNLIMITED_MEMBERS);
  assert.ok(UNLIMITED_MEMBERS > 10_000);
});

test('credits-only mode gives a workspace with no plan the top limits and no upsell', () => {
  const limits = billingModeRules('credits_only').noPlanLimits;
  assert.equal(billingModeRules('credits_only').sellsPlans, false);
  assert.deepEqual(limits, max);
  assert.equal(
    chatsAtOnceMessage(plain(limits)),
    'This workspace can run 10 chats at once. Wait for one to finish.',
  );
  assert.equal(
    scheduledTasksMessage(plain(limits)),
    'This workspace can have 50 active schedules. Delete one to add another.',
  );
  assert.equal(membersMessage(plain(limits)), 'This workspace has no limit on team members.');
});

test('subscription mode keeps a workspace with no plan small and points at a bigger plan', () => {
  const limits = billingModeRules('subscriptions').noPlanLimits;
  assert.equal(billingModeRules('subscriptions').sellsPlans, true);
  assert.deepEqual(limits, NO_PLAN_LIMITS);
  assert.equal(chatsAtOnceExceeded(1, limits), true);
  assert.equal(scheduledTasksExceeded(0, limits), true);
  assert.equal(membersExceeded(1, 0, limits), true);
  const refusal = { limits, biggerPlan: true };
  assert.equal(
    chatsAtOnceMessage(refusal),
    'This workspace can run 1 chat at once. Wait for one to finish. A bigger plan raises this limit.',
  );
  assert.equal(
    scheduledTasksMessage(refusal),
    'This workspace cannot have schedules. A bigger plan raises this limit.',
  );
  assert.equal(
    membersMessage(refusal),
    'This workspace can have 1 team member. A bigger plan raises this limit.',
  );
});

test('a schedule refusal names the active count and the stale schedules that do not count', () => {
  const message = scheduledTasksMessage(plain(pro), {
    activeCount: 5,
    staleNames: ['Old daily check', 'July reminder'],
  });
  assert.match(message, /You have 5 active schedules/);
  assert.match(message, /“Old daily check”, “July reminder”/);
  assert.match(message, /stale schedules do not count toward the limit/i);
});
