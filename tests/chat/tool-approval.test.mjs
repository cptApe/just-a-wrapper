/** An approval asks the right person, records the answer they chose, and never lets a task hang. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as zod from 'zod';
import { isChatWorking } from '../../src/features/chat/lib/chat-working.ts';
import * as retry from '../../src/features/chat/lib/custom-tool-dispatch-retry.ts';
import { createReducerStore } from '../../src/features/chat/lib/reducer-store.ts';
import {
  rememberScopeFor,
  selectPendingDecisions,
  toolGateOf,
} from '../../src/features/chat/lib/tool-decisions.ts';
import * as toolMachine from '../../src/features/chat/lib/tool-request-machine.ts';
import { loadTsx } from '../support/load-tsx.mjs';

const require = createRequire(import.meta.url);
const gate = (id, name, extra = {}) => ({
  type: 'tool',
  id,
  tool: 'mcp',
  name,
  input: {},
  evaluatedPermission: 'ask',
  ...extra,
});

const { ToolApproval } = loadTsx(
  'src/features/chat/components/tool-renderers/tool-approval.tsx',
  (name) => {
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react')
      return {
        ...React,
        useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      };
    if (name === '@/components/ui/button')
      return { Button: ({ children, ...props }) => React.createElement('button', props, children) };
    if (name === '@/components/icons') return { IconChevronDown: () => null };
    if (name === '@/components/ui/dropdown-menu') {
      const pass = ({ children, ...props }) => {
        delete props.asChild;
        delete props.align;
        return React.createElement('div', props, children);
      };
      return {
        DropdownMenu: pass,
        DropdownMenuTrigger: pass,
        DropdownMenuContent: pass,
        DropdownMenuItem: pass,
      };
    }
    throw new Error(`Unexpected ToolApproval dependency: ${name}`);
  },
);
const descendants = (node) =>
  React.isValidElement(node)
    ? [node, ...React.Children.toArray(node.props.children).flatMap(descendants)]
    : [];
const byTestId = (tree, id) => descendants(tree).find((node) => node.props['data-testid'] === id);
const card = ({ busy = false, remember = null } = {}) => {
  const decisions = [];
  const tree = ToolApproval({
    action: 'Wants to delete the calendar event',
    gate: { kind: 'pending', busy, remember, resolve: (decision) => decisions.push(decision) },
    viewerDecides: true,
  });
  return { tree, decisions };
};
const press = (tree, key, target) => {
  const self = {};
  tree.props.onKeyDown({ key, target: target ?? self, currentTarget: self, preventDefault() {} });
};

test('Approve, Deny, their keys and the remembered approval each send the decision they name', () => {
  const buttons = card();
  byTestId(buttons.tree, 'gate-approve').props.onClick();
  byTestId(buttons.tree, 'gate-deny').props.onClick();
  assert.deepEqual(buttons.decisions, ['once', 'deny']);
  const keys = card();
  press(keys.tree, 'Enter');
  press(keys.tree, 'Escape');
  press(keys.tree, 'Enter', {});
  assert.deepEqual(keys.decisions, ['once', 'deny']);
  for (const remember of ['always', 'session']) {
    const remembered = card({ remember });
    byTestId(remembered.tree, 'gate-approve-always').props.onSelect();
    assert.deepEqual(remembered.decisions, [remember]);
  }
});

test('a card already answering ignores a second key press', () => {
  const busy = card({ busy: true });
  press(busy.tree, 'Enter');
  assert.deepEqual(busy.decisions, []);
});

test('a teammate sees who must approve, with no button to approve it themselves', () => {
  const html = renderToStaticMarkup(
    ToolApproval({ action: 'Wants to send', gate: { kind: 'readonly' }, viewerDecides: false }),
  );
  assert.match(html, /Waiting for the task owner to approve/);
  assert.doesNotMatch(html, /<button|tabindex/i);
  const decisions = {
    pending: new Map([['a', { source: 'builtin', busy: false, remember: null }]]),
    canDecide: false,
    resolve() {},
  };
  assert.deepEqual(toolGateOf(decisions, 'a'), { kind: 'readonly' });
});

test('only the owner may always-allow an app action; nothing unreadable can be remembered', () => {
  assert.equal(rememberScopeFor(gate('a', 'GMAIL_SEND_EMAIL'), true), 'always');
  assert.equal(rememberScopeFor(gate('a', 'GMAIL_SEND_EMAIL'), false), 'session');
  assert.equal(rememberScopeFor(gate('a', 'COMPOSIO_SEARCH_TOOLS'), true), 'session');
  assert.equal(rememberScopeFor(gate('a', 'COMPOSIO_REMOTE_WORKBENCH'), true), null);
  assert.equal(rememberScopeFor(gate('a', 'bash'), true), null);
});

test('every waiting approval is listed, including those inside a helper; a stopped task waits on none', () => {
  const lane = {
    type: 'subagent',
    id: 'lane',
    status: 'running',
    entries: [{ sub: 'tool', id: 'e', item: gate('inner', 'GMAIL_SEND_EMAIL') }],
  };
  const select = (state, requests = new Map()) =>
    selectPendingDecisions({
      state,
      customPendingIds: ['held'],
      requests,
      canSetGlobalPermission: true,
    });
  const pending = select(
    { status: 'idle', items: [gate('send', 'GMAIL_SEND_EMAIL'), lane] },
    new Map([['held', { kind: 'confirming', attempt: Symbol() }]]),
  );
  assert.deepEqual([...pending.keys()].sort(), ['held', 'inner', 'send']);
  assert.equal(pending.get('held').busy, true);
  assert.equal(
    select({ status: 'idle', items: [] }, new Map([['held', { kind: 'posted' }]])).size,
    0,
  );
  for (const status of ['terminated', 'paused_no_credits'])
    assert.equal(select({ status, items: [gate('a', 'GMAIL_SEND_EMAIL')] }).size, 0);
});

test('a task parked on an approval lets the person act; one running its own tool stays busy', () => {
  const call = { type: 'tool', id: 'browser', tool: 'custom', name: 'browse_act', input: {} };
  const parked = { status: 'idle', stopReason: 'requires_action', items: [call] };
  const busy = (overrides) =>
    isChatWorking({
      state: parked,
      streamStatus: 'open',
      sendInFlight: false,
      pendingUserToolUseIds: new Set(),
      autoDispatchToolUseIds: new Set(),
      ...overrides,
    });
  assert.equal(busy({ autoDispatchToolUseIds: new Set(['browser']) }), true);
  assert.equal(
    busy({
      autoDispatchToolUseIds: new Set(['browser']),
      pendingUserToolUseIds: new Set(['browser']),
    }),
    false,
  );
  assert.equal(busy({}), false, 'a call whose dispatch gave up does not spin forever');
  assert.equal(
    busy({ state: { ...parked, items: [{ ...call, result: { isError: false, text: 'done' } }] } }),
    false,
  );
});

function decisionRequests(failure, toasts) {
  const dependencies = {
    zod,
    sonner: { toast: { error: (message) => toasts.push(message) } },
    '@/lib/fetch-json': {
      fetchJson: async () => {
        throw failure;
      },
    },
    '@/lib/observability-client': { captureException() {} },
    '../lib/custom-tool-dispatch-retry': retry,
    '../lib/tool-request-machine': toolMachine,
  };
  return loadTsx('src/features/chat/api/tool-decision-requests.ts', (name) => {
    assert.ok(name in dependencies, `unmocked dependency ${name}`);
    return dependencies[name];
  });
}
const scope = () => {
  const store = createReducerStore(new Map(), toolMachine.toolRequestReducer);
  store.dispatch({ type: 'pending', id: 'gate' });
  return {
    sessionId: 'session',
    store,
    queryClient: { invalidateQueries: async () => {}, setQueryData() {} },
    pendingKey: ['pending'],
    reattach: () => assert.fail('a failed answer must not reattach'),
  };
};

test('an answer that fails to send says so and leaves the approval waiting', async () => {
  for (const failure of [new TypeError('Failed to fetch'), new SyntaxError('Unexpected token')]) {
    const toasts = [];
    const builtin = scope();
    await decisionRequests(failure, toasts).answerBuiltinGate(
      builtin,
      { toolUseId: 'gate' },
      'once',
      () => assert.fail('a failed answer must not fold a confirmation'),
    );
    const custom = scope();
    await decisionRequests(failure, toasts).answerCustomTool(custom, 'gate', 'allow');
    assert.equal(toasts.length, 2);
    for (const { store } of [builtin, custom])
      assert.deepEqual(store.getSnapshot().get('gate'), { kind: 'pending' });
  }
});
