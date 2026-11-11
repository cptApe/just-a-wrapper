// The chat list in the sidebar: rows are never duplicated or lost, and stale events cannot hide a pause or a running send.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { sessionQueryKeys } from '../../src/features/sessions/api/keys.ts';
import {
  insertRowAtTop,
  mergePendingSessionRows,
  patchRow,
  removeRow,
  replaceCreatedRow,
} from '../../src/features/sessions/api/session-list-cache.ts';
import {
  applySessionChatEvent,
  beginSessionActivity,
  cachedSessionStatus,
  preservePendingSessionSends,
  runWithSessionActivity,
  updateSessionActivity,
} from '../../src/features/sessions/api/session-live-cache.ts';

const listRow = (id, title = 'Untitled') => ({ id, title, status: 'running', unread: false });
const ids = (cache) => cache.pages.flatMap((page) => page.items.map((item) => item.id));
const idle = {
  id: 'idle',
  kind: 'status',
  rawType: 'session.status_idle',
  status: 'idle',
  stopReason: 'end_turn',
};

function setup() {
  const client = new QueryClient();
  const key = sessionQueryKeys.list('workspace');
  client.setQueryData(key, {
    pages: [{ items: [{ id: 'task', status: 'running', unread: false }], nextCursor: null }],
    pageParams: [null],
  });
  return { client, row: () => client.getQueryData(key).pages[0].items[0] };
}

test('a new chat shows at once, survives a refetch, and appears once with the server title after creation', () => {
  const pending = listRow('pending-one');
  const refetched = [listRow('older')];
  assert.deepEqual(mergePendingSessionRows(refetched, [pending]), [pending, ...refetched]);
  assert.deepEqual(mergePendingSessionRows([pending, ...refetched], [pending]), [
    pending,
    ...refetched,
  ]);
  const serverRow = listRow('real-id', 'Generated title');
  const cache = {
    pages: [
      { items: [pending, serverRow], nextCursor: 'older' },
      { items: [serverRow, listRow('older')], nextCursor: null },
    ],
    pageParams: [null, 'older'],
  };
  const replaced = replaceCreatedRow(cache, pending, 'real-id');
  assert.deepEqual(ids(replaced), ['real-id', 'older']);
  assert.equal(replaced.pages[0].items[0].title, 'Generated title');
});

test('a failed creation removes only its own row and keeps a rename made meanwhile', () => {
  const pending = listRow('pending-one');
  const cache = insertRowAtTop(insertRowAtTop(undefined, listRow('other')), pending);
  const edited = patchRow(cache, 'other', { title: 'Renamed while creating' });
  assert.deepEqual(removeRow(edited, pending.id).pages[0].items, [
    listRow('other', 'Renamed while creating'),
  ]);
});

test('a finished turn marks the chat unread only when the person is looking at another chat', () => {
  for (const [open, unread] of [
    [true, false],
    [false, true],
  ]) {
    const { client, row } = setup();
    applySessionChatEvent(client, 'task', idle, open);
    assert.equal(row().status, 'idle');
    assert.equal(row().unread, unread);
    client.clear();
  }
});

test('an old idle from a replay, a stream or a refetch cannot stop the spinner of a send in flight', () => {
  const { client, row } = setup();
  applySessionChatEvent(client, 'task', idle, true);
  beginSessionActivity(client, 'task');
  applySessionChatEvent(client, 'task', { ...idle, at: '2020-01-01T00:00:00Z' }, true, true);
  updateSessionActivity(client, 'task', 'idle', true);
  assert.equal(row().status, 'running');
  const page = preservePendingSessionSends(client, {
    items: [{ id: 'task', status: 'idle', unread: true }],
    nextCursor: null,
  });
  assert.equal(page.items[0].status, 'running');
  updateSessionActivity(client, 'task', 'running', true);
  updateSessionActivity(client, 'task', 'idle', true);
  assert.equal(row().status, 'idle', 'once the send is claimed, a real idle lands');
  client.clear();
});

test('a failed send puts the old status back, but never over a newer one', () => {
  const { client, row } = setup();
  applySessionChatEvent(client, 'task', idle, true);
  beginSessionActivity(client, 'task')();
  assert.equal(row().status, 'idle');
  const rollback = beginSessionActivity(client, 'task');
  applySessionChatEvent(client, 'task', { ...idle, stopReason: 'requires_action' }, true);
  rollback();
  assert.equal(row().status, 'requires_input');
  client.clear();
});

test('a replay or a late upload failure cannot hide a credit pause', async () => {
  const { client, row } = setup();
  updateSessionActivity(client, 'task', 'paused_no_credits', true);
  applySessionChatEvent(client, 'task', idle, true, true);
  assert.equal(row().status, 'paused_no_credits');
  const failure = new Error('upload failed');
  await assert.rejects(
    runWithSessionActivity(client, 'task', async () => {
      updateSessionActivity(client, 'task', 'paused_no_credits', true);
      throw failure;
    }),
    failure,
  );
  assert.equal(row().status, 'paused_no_credits');
  client.clear();
});

test('an event for a chat this workspace does not list adds nothing to the list', () => {
  const { client, row } = setup();
  applySessionChatEvent(client, 'unknown', idle, false);
  assert.equal(row().status, 'running');
  assert.equal(cachedSessionStatus(client, 'unknown'), null);
  client.clear();
});
