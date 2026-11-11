/** The gate's trust contract as pure input and output: which calls run, ask or are refused.
 * The database-backed paths (rows, unattended refusals, remembered approvals) are in
 * tests/integration/tool-approvals.test.ts and tool-dispatch.test.ts. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { classifyToolAccess } from '../../src/features/permissions/lib/classify.ts';
import {
  combineGateOutcomes,
  decideConnectedAppGate,
  readGatedCall,
  TOOL_ROUTER_EXECUTOR,
  toolkitFromToolName,
} from '../../src/features/permissions/lib/resolve.ts';
import { BUILTIN_TOOL_NAMES } from '../../src/features/tool-catalog/builtin-tools.ts';
import { CUSTOM_TOOL_NAMES } from '../../src/features/tool-catalog/declarations.ts';

const TOOLKITS = ['gmail', 'googlecalendar', 'googledrive', 'slack', 'github'];

test('a saved row decides a connected-app action; with no row only reads in auto mode run', () => {
  for (const access of ['read', 'write']) {
    for (const sessionMode of ['ask', 'auto']) {
      assert.equal(decideConnectedAppGate({ policy: 'block', access, sessionMode }), 'deny');
      assert.equal(decideConnectedAppGate({ policy: 'allow', access, sessionMode }), 'allow');
      assert.equal(decideConnectedAppGate({ policy: 'ask', access, sessionMode }), 'gate');
    }
  }
  const noRow = (access, sessionMode) =>
    decideConnectedAppGate({ policy: null, access, sessionMode });
  assert.equal(noRow('read', 'auto'), 'allow');
  assert.equal(noRow('read', 'ask'), 'gate');
  assert.equal(noRow('write', 'auto'), 'gate');
  assert.equal(noRow('write', 'ask'), 'gate');
});

test('one blocked action denies the whole batch, then a refusal, then an ask', () => {
  assert.equal(combineGateOutcomes(['allow', 'deny', 'gate', 'refuse']), 'deny');
  assert.equal(combineGateOutcomes(['allow', 'refuse', 'gate']), 'refuse');
  assert.equal(combineGateOutcomes(['allow', 'gate']), 'gate');
  assert.equal(combineGateOutcomes(['allow', 'allow']), 'allow');
});

test('an executor batch is gated as each exact action it holds', () => {
  const input = {
    tools: [
      { tool_slug: 'GMAIL_SEND_EMAIL', arguments: {} },
      { tool_slug: 'GMAIL_SEND_EMAIL' },
      { tool_slug: 'SLACK_SEND_MESSAGE' },
    ],
  };
  assert.deepEqual(readGatedCall(TOOL_ROUTER_EXECUTOR, input, TOOLKITS), {
    kind: 'actions',
    actions: [
      { toolkit: 'gmail', toolName: 'GMAIL_SEND_EMAIL' },
      { toolkit: 'slack', toolName: 'SLACK_SEND_MESSAGE' },
    ],
  });
  assert.deepEqual(readGatedCall('COMPOSIO_SEARCH_TOOLS', {}, TOOLKITS), {
    kind: 'read_only_meta',
    toolName: 'COMPOSIO_SEARCH_TOOLS',
  });
});

test('a call the gate cannot read action by action is opaque, never silently allowed', () => {
  for (const name of [
    'COMPOSIO_REMOTE_WORKBENCH',
    'COMPOSIO_REMOTE_BASH_TOOL',
    'COMPOSIO_SOME_NEW_TOOL',
    'NOTATOOLKIT_SEND',
  ]) {
    assert.deepEqual(readGatedCall(name, { code: 'x' }, TOOLKITS), { kind: 'opaque' }, name);
  }
  for (const input of [
    null,
    {},
    { tools: 'nope' },
    { tools: [] },
    { tools: [{ arguments: {} }] },
    // One readable entry must not hide an unreadable one.
    { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS' }, { slug: 'GMAIL_SEND_EMAIL' }] },
    { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS' }, null] },
    { tools: [{ tool_slug: '' }] },
    { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS' }, { tool_slug: 'COMPOSIO_REMOTE_WORKBENCH' }] },
  ]) {
    assert.deepEqual(readGatedCall(TOOL_ROUTER_EXECUTOR, input, TOOLKITS), { kind: 'opaque' });
  }
});

test('an action is checked against its own app, never a shorter app name that prefixes it', () => {
  assert.equal(toolkitFromToolName('GMAIL_FETCH_EMAILS', TOOLKITS), 'gmail');
  assert.equal(
    toolkitFromToolName('GOOGLECALENDAR_CREATE_EVENT', ['google', 'googlecalendar']),
    'googlecalendar',
  );
  for (const name of ['web_search', 'COMPOSIO_SEARCH_TOOLS', 'GMAIL']) {
    assert.equal(toolkitFromToolName(name, TOOLKITS), null, name);
  }
});

// The cached Composio catalogue: 838 real actions across nine toolkits, no network.
const catalog = JSON.parse(
  readFileSync(new URL('../fixtures/connected-tool-catalog.json', import.meta.url), 'utf8'),
);
const catalogTools = Object.values(catalog).flatMap((entries) => entries);
const WRITE_HINTS = new Set(['destructiveHint', 'createHint', 'updateHint']);

// Read-tagged actions the slug fallback calls writes. Each gets an exact allow row at
// connect time; if that row is missing, asking is the safe mistake.
const SAFE_DIRECTION_DISAGREEMENTS = [
  'FACEBOOK_GET_POST',
  'FACEBOOK_GET_POST_INSIGHTS',
  'FACEBOOK_GET_POST_REACTIONS',
  'GMAIL_CREATE_PROMPT_POST',
  'GMAIL_LIST_SEND_AS',
  'GMAIL_SETTINGS_SEND_AS_GET',
  'GOOGLECALENDAR_EVENTS_INSTANCES',
  'GOOGLECALENDAR_SYNC_EVENTS',
  'GOOGLEDRIVE_GENERATE_IDS',
  'GOOGLEDRIVE_GET_REPLY',
  'GOOGLEDRIVE_PARSE_FILE',
  'GOOGLESHEETS_AGGREGATE_COLUMN_DATA',
  'NOTION_CREATE_VIEW_QUERY',
  'NOTION_RETRIEVE_FILE_UPLOAD',
  'STRIPE_CREATE_PREVIEW_INVOICE',
  'STRIPE_GET_APPLE_PAY_DOMAIN',
  'STRIPE_GET_CHARGES_CHARGE_DISPUTE',
  'STRIPE_GET_CHARGES_CHARGE_REFUNDS_REFUND',
  'STRIPE_GET_REFUNDS_REFUND',
  'STRIPE_GET_REPORTING_REPORT_RUNS_REPORT_RUN',
  'STRIPE_GET_SUBSCRIPTION_SCHEDULES_SCHEDULE',
  'STRIPE_GET_TRANSFER_REVERSAL',
  'STRIPE_LIST_APPLE_PAY_DOMAINS',
  'STRIPE_LIST_CHARGE_REFUNDS',
  'STRIPE_POST_V1_CUSTOMERS_SEARCH_CUSTOMERS',
  'STRIPE_RETRIEVE_CHARGE',
].sort();

test('no real write action is ever classified as a read, from its tags or its name alone', () => {
  const unsafe = [];
  const safe = [];
  const tagDisagreements = [];
  for (const [slug, tags] of catalogTools) {
    const hintedWrite = tags.some((tag) => WRITE_HINTS.has(tag));
    const hintedRead = tags.includes('readOnlyHint') && !hintedWrite;
    const fromName = classifyToolAccess(slug);
    if (hintedWrite && fromName === 'read') unsafe.push(slug);
    if (hintedRead && fromName === 'write') safe.push(slug);
    const expected = hintedWrite ? 'write' : hintedRead ? 'read' : null;
    if (expected !== null && classifyToolAccess(slug, tags) !== expected)
      tagDisagreements.push(slug);
  }
  assert.deepEqual(unsafe, []);
  assert.deepEqual(safe.sort(), SAFE_DIRECTION_DISAGREEMENTS);
  assert.deepEqual(tagDisagreements, []);
});

test('an action with no recognised verb or a write verb anywhere is treated as a write', () => {
  for (const slug of [
    'SOMETOOL_MYSTERY_ACTION',
    'NOTION_UPDATE_VIEW',
    'GMAIL_MOVE_THREAD_TO_TRASH',
    'GOOGLECALENDAR_CALENDAR_LIST_DELETE',
    'GOOGLECALENDAR_CALENDAR_LIST_WATCH',
    'GOOGLESHEETS_FIND_REPLACE',
    'STRIPE_DELETEV1_SUBSCRIPTIONS_LIST_SUBSCRIPTIONS',
  ]) {
    assert.equal(classifyToolAccess(slug), 'write', slug);
  }
  assert.equal(classifyToolAccess('ODD_GET_THAT_WRITES', ['destructiveHint']), 'write');
  assert.equal(classifyToolAccess('ODD_GET', ['readOnlyHint', 'destructiveHint']), 'write');
});

test('no custom tool shares a name with a built-in, so it cannot dodge its own policy', () => {
  const builtins = new Set(BUILTIN_TOOL_NAMES);
  assert.deepEqual(
    CUSTOM_TOOL_NAMES.filter((name) => builtins.has(name)),
    [],
  );
});
