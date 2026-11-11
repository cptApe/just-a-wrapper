/** Who gets notified of what: real emitters, preference gates and dispatch. The database and email sender are faked here. */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

const fixture = {
  row: null,
  preferences: [],
  preferenceError: false,
  sends: [],
  errors: [],
  members: [],
  notifications: [],
};
globalThis.__taskEmailOptIn = fixture;
const source = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const notifyUrl = new URL('../../src/features/notifications/api/notify.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const modules = {
      '@/features/billing/api/spend-gate': 'export const assertCanSpend = async () => {};',
      './assert-schedule-limit': 'export const assertCanCreateScheduledTask = async () => {};',
      '@/features/billing/api/sync-session-budgets':
        'export const AUTO_RESUME_CUTOFF_MS = 1800000;',
      '@/db': `const f=globalThis.__taskEmailOptIn;
      export const db={select:()=>{let table; const q={from:t=>{table=t;return q},innerJoin:()=>q,leftJoin:()=>q,where:()=>q,limit:async()=>f.row?[{...f.row,task:f.row}]:[],then:(resolve,reject)=>{const result=table.name==='preferences'?(f.preferenceError?Promise.reject(new Error('preference database unavailable')):Promise.resolve(f.preferences)):Promise.resolve(f.row?[f.row]:[]);return result.then(resolve,reject)}};return q},
      insert:()=>({values:row=>({onConflictDoNothing:()=>({returning:async()=>{const stored={id:String(f.notifications.length),emailedAt:null,...row};f.notifications.push(stored);return [stored]}})})}),
      update:()=>({set:patch=>({where:()=>({
        then:(resolve)=>resolve(),
        returning:async()=>{const row=f.notifications.find(row=>patch.emailStatus==='sending'?row.emailStatus==='pending':row.emailStatus==='sending');if(!row)return [];if(patch.emailStatus==='sending' && row.emailStatus!=='pending')return [];Object.assign(row,patch);return [row]}
      })})}),
      transaction:async fn=>fn({insert:()=>({values:()=>({onConflictDoNothing:()=>({returning:async()=>[{eventId:'event'}]})})}),update:()=>({set:()=>({where:()=>({returning:async()=>[{id:'task',version:2}]})})})})};`,
      '@/db/schema': `export const session={id:'id',kind:'kind',title:'title',visibility:'visibility',createdByUserId:'createdByUserId',workspaceId:'workspaceId',taskId:'taskId',anthropicSessionId:'anthropicSessionId'}; export const task={id:'id',notification:'notification',workspaceId:'workspaceId',anthropicDeploymentId:'anthropicDeploymentId',status:'status'};export const workspace={id:'id',organizationId:'organizationId'};export const notification={id:'id',organizationId:'organizationId',recipientUserId:'recipientUserId',idempotencyKey:'idempotencyKey'};export const notificationPreference={name:'preferences',userId:'userId',category:'category',email:'email',inApp:'inApp'};export const processedWebhookEvent={provider:'provider',eventId:'eventId'};`,
      '@/features/agents': `export const requireAnthropicClient=()=>({beta:{deployments:{retrieve:async()=>({status:'paused',archived_at:null,schedule:null})},deploymentRuns:{retrieve:async()=>({id:'run',deployment_id:'deployment',error:{message:'Failed'}})}}});`,
      '@/lib/logger': 'export const shipLog=()=>{};',
      '@/lib/brand/contact':
        "export const readContactDetails=async()=>({supportEmail:'help@acme.example'});",
      '@/lib/observability':
        'export const captureException=error=>globalThis.__taskEmailOptIn.errors.push(error);',
      '@/lib/request-context': 'export const extend=()=>{};',
      '@/features/realtime/server': 'export const publishMemberEvent=async()=>{};',
      '@/lib/runtime-capabilities':
        "export const capabilities={email:{kind:'resend',apiKey:'test'}};export const composioCapability=()=>({apiKey:'test'});",
      './send-transactional-email':
        'export const sendTransactionalEmail=async payload=>globalThis.__taskEmailOptIn.sends.push(payload);',
      '../lib/recipients':
        'export const recipientsForOrg=async()=>globalThis.__taskEmailOptIn.members;',
      './composio-triggers':
        'export const deleteTriggerInstance=async()=>{};export const setTriggerInstanceStatus=async()=>{};',
      // Deployment pushes are not under test; their builders pull the whole session runtime.
      './build-task-deployment': 'export const buildTaskDeployment=async()=>({});',
      './deployment-fingerprint': "export const deploymentFingerprint=async()=>'hash';",
      './adopt-task-run':
        'export const adoptTaskRunSession=async()=>null;export const adoptTaskRunBySessionId=async()=>null;export const refreshTaskRunTimes=async()=>{};',
    };
    if (specifier === '@/features/notifications/server')
      return { url: notifyUrl, shortCircuit: true };
    if (Object.hasOwn(modules, specifier))
      return { url: source(modules[specifier]), shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { notifyTaskEvent } = await import(
  '../../src/features/notifications/api/notify-task-events.ts'
);
const { notify } = await import('../../src/features/notifications/api/notify.ts');
const { emailEnabledUserIds } = await import(
  '../../src/features/notifications/api/preference-gates.ts'
);
const { completeDeploymentRunFailure } = await import(
  '../../src/features/tasks/api/complete-task-run.ts'
);
const { mirrorDeploymentState } = await import('../../src/features/tasks/api/task-lifecycle.ts');
const { DEFAULT_PREFERENCES, PREFERENCE_CATEGORIES } = await import(
  '../../src/features/notifications/constants.ts'
);
const { isAway, NOTIFICATION_EVENTS } = await import(
  '../../src/features/notifications/lib/events.ts'
);
const { notificationEmailMachine } = await import(
  '../../src/features/notifications/lib/notification-machine.ts'
);
const { PREFERENCE_ROWS } = await import('../../src/features/notifications/lib/preference-rows.ts');
const { notificationChannels } = await import(
  '../../src/features/notifications/lib/task-notification.ts'
);

beforeEach(() => {
  fixture.row = {
    id: 'session',
    kind: 'chat',
    visibility: 'private',
    title: 'Client update',
    createdByUserId: 'owner',
    organizationId: 'org',
    taskNotification: null,
    notification: 'off',
    status: 'upcoming',
    providerSync: 'synced',
    version: 1,
    updatedAt: new Date(),
  };
  fixture.preferences = [];
  fixture.preferenceError = false;
  fixture.sends = [];
  fixture.notifications = [];
  fixture.errors = [];
  fixture.members = [
    { userId: 'owner', email: 'owner@example.com', lastActiveAt: new Date(0) },
    { userId: 'colleague', email: 'colleague@example.com', lastActiveAt: new Date(0) },
  ];
});
const emails = () => fixture.sends;
const emit = (event) =>
  notifyTaskEvent({ anthropicSessionId: 'anthropic-session', event, eventId: 'event' });

const TASK_EVENTS = ['task.completed', 'task.failed', 'task.needs_input'];
const EMAILING = ['email', 'email_app'];

test('a scheduled run emails only when its schedule asks for email, even if the person turned task email on', async () => {
  for (const event of TASK_EVENTS)
    for (const choice of ['email', 'email_app', 'app', 'off', null]) {
      fixture.sends = [];
      fixture.notifications = [];
      fixture.row.kind = 'task_run';
      fixture.row.taskNotification = choice;
      fixture.preferences = [
        { userId: 'owner', email: true },
        { userId: 'colleague', email: true },
      ];
      await emit(event);
      assert.equal(emails().length, EMAILING.includes(choice) ? 1 : 0, `${event} ${choice}`);
    }
});

test('a chat emails only its creator, only after they turned task email on, and never on a failed preference read', async () => {
  assert.equal(DEFAULT_PREFERENCES.task_alerts.email, false);
  assert.deepEqual([...(await emailEnabledUserIds(['owner'], 'task_alerts'))], []);
  for (const event of TASK_EVENTS)
    for (const [preferences, failing, to] of [
      [[], false, []],
      [[{ userId: 'owner', email: false }], false, []],
      [[{ userId: 'owner', email: true }], false, ['owner@example.com']],
      [[{ userId: 'owner', email: true }], true, []],
    ]) {
      fixture.sends = [];
      fixture.notifications = [];
      fixture.preferences = preferences;
      fixture.preferenceError = failing;
      await emit(event);
      assert.deepEqual(
        emails().map((email) => email.to),
        to,
        `${event} ${JSON.stringify(preferences)} failing=${failing}`,
      );
    }
});

test('a schedule set to email still emails when the preference read fails, and a run with no schedule never borrows chat email', async () => {
  fixture.row.kind = 'task_run';
  fixture.row.taskNotification = 'email';
  fixture.preferenceError = true;
  await emit('task.completed');
  assert.equal(emails().length, 1);

  fixture.sends = [];
  fixture.notifications = [];
  fixture.preferenceError = false;
  fixture.row.taskNotification = null;
  fixture.preferences = [{ userId: 'owner', email: true }];
  await emit('task.completed');
  assert.equal(emails().length, 0);
});

test('chat email skips a person who is active right now, but a schedule set to email reaches them and says why', async () => {
  fixture.preferences = [{ userId: 'owner', email: true }];
  fixture.members[0].lastActiveAt = new Date();
  await emit('task.completed');
  assert.equal(emails().length, 0);

  fixture.row.kind = 'task_run';
  fixture.row.taskNotification = 'email';
  await emit('task.completed');
  assert.deepEqual(
    emails().map((email) => email.to),
    ['owner@example.com'],
  );
  assert.match(emails()[0].email.text, /the schedule is set to email you/);
});

test('a shared schedule notifies every member of the workspace', async () => {
  fixture.row.kind = 'task_run';
  fixture.row.visibility = 'workspace';
  fixture.row.taskNotification = 'email_app';
  await emit('task.completed');
  assert.equal(emails().length, 2);
});

test('a failed or auto-paused deployment emails the schedule owner only when the schedule asks for email', async () => {
  const runs = [
    () =>
      completeDeploymentRunFailure({
        anthropicDeploymentRunId: 'run',
        webhookEventId: 'event',
        occurredAt: '2026-09-15T12:00:00Z',
      }),
    () => mirrorDeploymentState({ anthropicDeploymentId: 'deployment', webhookEventId: 'event' }),
  ];
  for (const run of runs)
    for (const choice of ['email', 'email_app', 'app', 'off']) {
      fixture.sends = [];
      fixture.notifications = [];
      fixture.row.notification = choice;
      await run();
      assert.deepEqual(
        emails().map((email) => email.to),
        EMAILING.includes(choice) ? ['owner@example.com'] : [],
        choice,
      );
    }
});

test('urgent account problems email every away member, no active member, and nobody on a failed preference read', async () => {
  for (const event of ['credits.paused', 'payment.failed', 'integration.broken']) {
    fixture.sends = [];
    fixture.notifications = [];
    fixture.preferenceError = false;
    fixture.members.forEach((member) => (member.lastActiveAt = new Date(0)));
    await notify(event, { organizationId: 'org' });
    assert.equal(emails().length, 2, event);
    fixture.sends = [];
    fixture.notifications = [];
    fixture.members.forEach((member) => (member.lastActiveAt = new Date()));
    await notify(event, { organizationId: 'org' });
    assert.equal(emails().length, 0, event);
    fixture.members.forEach((member) => (member.lastActiveAt = new Date(0)));
    fixture.preferenceError = true;
    await assert.rejects(
      notify(event, { organizationId: 'org' }),
      /preference database unavailable/,
    );
    assert.equal(emails().length, 0, event);
  }
});

test('a person counts as away after ten minutes without activity', () => {
  const now = new Date('2026-07-02T12:00:00Z');
  for (const [lastActiveAt, away] of [
    [null, true],
    [new Date('2026-07-02T11:45:00Z'), true],
    [new Date('2026-07-02T11:50:00Z'), true],
    [new Date('2026-07-02T11:55:00Z'), false],
  ])
    assert.equal(isAway(lastActiveAt, now), away, String(lastActiveAt));
});

test('each schedule notification choice turns on exactly its channels', () => {
  for (const [choice, channels] of [
    ['email_app', { email: true, inApp: true }],
    ['email', { email: true, inApp: false }],
    ['app', { email: false, inApp: true }],
    ['off', { email: false, inApp: false }],
  ])
    assert.deepEqual(notificationChannels(choice), channels, choice);
});

test('every notification switch in settings controls at least one event that delivers on it', () => {
  const categories = new Set(PREFERENCE_CATEGORIES);
  for (const [name, event] of Object.entries(NOTIFICATION_EVENTS))
    assert.ok(categories.has(event.preference), `${name} -> ${event.preference}`);
  for (const row of PREFERENCE_ROWS) {
    const events = Object.values(NOTIFICATION_EVENTS).filter(
      (event) => event.preference === row.category,
    );
    if (row.channels.inApp) assert.ok(events.length > 0, `${row.category} in-app controls nothing`);
    if (row.channels.email)
      assert.ok(
        events.some((event) => event.email),
        `${row.category} email controls nothing`,
      );
  }
});

test('a notification email is sent at most once: sent, skipped and expired are final', () => {
  const edges = {
    pending: ['sending', 'skipped', 'expired'],
    sending: ['pending', 'sent', 'skipped', 'expired'],
    sent: [],
    skipped: [],
    expired: [],
  };
  assert.deepEqual([...notificationEmailMachine.states].sort(), Object.keys(edges).sort());
  for (const from of notificationEmailMachine.states)
    for (const to of notificationEmailMachine.states) {
      const allowed = edges[from].includes(to);
      assert.equal(notificationEmailMachine.can(from, to), allowed, `${from} -> ${to}`);
      assert.equal(notificationEmailMachine.sourcesOf(to).includes(from), allowed);
      if (allowed) assert.doesNotThrow(() => notificationEmailMachine.assertCan(from, to));
      else assert.throws(() => notificationEmailMachine.assertCan(from, to));
    }
});
