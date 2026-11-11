/** A public task link shows only what is safe to publish, and stops working once revoked, expired or deleted. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { publicShareStatus } from '../../src/features/chat/lib/public-share-status.ts';
import { projectPublicTranscript } from '../../src/features/chat/lib/public-transcript.ts';
import { loadTsx } from '../support/load-tsx.mjs';

const require = createRequire(import.meta.url);
const PRIVATE_URL = 'https://cdn.example.invalid/acct/files/report.pdf?token=abc123';
const SANDBOX_PATH = '/mnt/session/uploads/report.pdf';
const FOLDER_PATH = '/finance/q3-hidden';
const block = (lines, tag = 'attached_files') => `<${tag}>\n${lines.join('\n')}\n</${tag}>`;
const userSays = (text, extra = {}) => ({
  id: 'u',
  kind: 'message',
  rawType: 'user.message',
  role: 'user',
  text,
  ...extra,
});
const call = (id, extra = {}) => ({
  id,
  kind: 'tool_use',
  rawType: 'agent.custom_tool_use',
  tool: 'custom',
  name: 'web_search',
  input: { secret: 'PRIVATE INPUT' },
  ...extra,
});
const result = (id, isError = false, extra = {}) => ({
  id: `result-${id}`,
  kind: 'tool_result',
  rawType: 'x',
  toolUseId: id,
  text: 'PRIVATE OUTPUT',
  isError,
  ...extra,
});
function assertNothingPrivate(items) {
  const serialized = JSON.stringify(items);
  for (const secret of [
    'PRIVATE',
    'example.invalid',
    SANDBOX_PATH,
    FOLDER_PATH,
    'Library folder',
    'Agent sandbox path',
    'file_01HZX',
    'just-a-raw-machine-line',
    'input',
    'toolUseId',
  ])
    assert.ok(!serialized.includes(secret), `${secret} leaked`);
  assert.ok(!/attached_files/i.test(serialized), 'internal tag leaked');
}

test('a link is live only while it is unrevoked, unexpired, its task exists and its workspace is live', () => {
  const now = new Date('2026-07-04T12:00:00Z');
  const past = new Date('2026-07-03T12:00:00Z');
  const future = new Date('2026-07-05T12:00:00Z');
  const live = { expiresAt: null, revokedAt: null, hiddenAt: null, workspaceLive: true };
  for (const [share, expected] of [
    [live, 'live'],
    [{ ...live, hiddenAt: past }, 'revoked'],
    [{ ...live, expiresAt: future, hiddenAt: now }, 'revoked'],
    [{ ...live, revokedAt: past }, 'revoked'],
    [{ ...live, expiresAt: past }, 'expired'],
    [{ ...live, expiresAt: future, workspaceLive: false }, 'revoked'],
  ])
    assert.equal(publicShareStatus(share, now), expected, JSON.stringify(share));
});

test('tool calls show only their name and status: no arguments, results, thinking or errors', () => {
  const items = projectPublicTranscript([
    userSays('Check the report'),
    { id: 'thought', kind: 'thinking', rawType: 'x', text: 'PRIVATE THINKING' },
    call('a'),
    result('a'),
    call('b', {
      rawType: 'agent.mcp_tool_use',
      tool: 'mcp',
      name: 'GMAIL_SEND_EMAIL',
      input: { body: 'PRIVATE BODY' },
    }),
    result('b', true),
    call('batch', {
      name: 'COMPOSIO_MULTI_EXECUTE_TOOL',
      input: {
        tools: [{ tool_slug: 'GMAIL_SEND_EMAIL', arguments: { subject: 'PRIVATE SUBJECT' } }],
      },
    }),
    call('file'),
    result('file', false, {
      fileRefs: [{ fileId: 'PRIVATE ID', blockType: 'document', title: 'Report.pdf' }],
    }),
    { id: 's1', kind: 'status', rawType: 'x', status: 'running' },
    { id: 'er', kind: 'error', rawType: 'x', text: 'PRIVATE stack trace' },
  ]);
  assert.deepEqual(
    items.map((item) => [item.kind, item.tool ?? item.role, item.status]),
    [
      ['message', 'user', undefined],
      ['tool', 'web_search', 'done'],
      ['tool', 'GMAIL_SEND_EMAIL', 'failed'],
      ['tool', 'COMPOSIO_MULTI_EXECUTE_TOOL', 'interrupted'],
      ['tool', 'web_search', 'done'],
      ['message', 'assistant', undefined],
    ],
  );
  // A tool's result files publish by name only, as their own row.
  assert.deepEqual(items.at(-1).fileNames, ['Report.pdf']);
  assertNothingPrivate(items);
});

test('approval decisions read the same on the public page as in the task', () => {
  const items = projectPublicTranscript(
    [
      call('ask', { evaluatedPermission: 'ask' }),
      call('deny', { evaluatedPermission: 'ask' }),
      {
        id: 'decision',
        kind: 'tool_confirmation',
        rawType: 'x',
        toolUseId: 'deny',
        result: 'deny',
      },
      call('denied-custom'),
      result('denied-custom', true, {
        text: JSON.stringify({ code: 'USER_DENIED', message: 'Denied.' }),
      }),
      call('held'),
      call('settled'),
      result('settled'),
      call('unfinished'),
    ],
    new Set(['held', 'settled']),
  );
  assert.deepEqual(
    items.map((item) => item.status),
    ['gated', 'denied', 'denied', 'gated', 'done', 'interrupted'],
  );
  assert.ok(!JSON.stringify(items).includes('USER_DENIED'));
});

test('attached files publish as plain names; their links, paths and agent notes never do', () => {
  const cases = [
    [
      `Please summarize this.\n\n${block([
        `report.pdf — ${PRIVATE_URL}`,
        `Agent sandbox path for report.pdf: ${SANDBOX_PATH}`,
        `Q3 Numbers/ (folder) — Library folder ${FOLDER_PATH}`,
      ])}`,
      [{ text: 'Please summarize this.', fileNames: ['report.pdf', 'Q3 Numbers'] }],
    ],
    [block([`report.pdf — ${PRIVATE_URL}`]), [{ text: '', fileNames: ['report.pdf'] }]],
    [
      [
        'First.',
        block([`a.pdf — ${PRIVATE_URL}`]),
        'Typed https://public.example.com/page',
        block([`b.pdf — ${PRIVATE_URL}`], 'ATTACHED_FILES'),
        'Third.',
      ].join('\n\n'),
      [
        {
          text: 'First.\nTyped https://public.example.com/page\nThird.',
          fileNames: ['a.pdf', 'b.pdf'],
        },
      ],
    ],
    [
      `Look.\n\n${block([
        'just-a-raw-machine-line',
        'file_01HZX0000000000000000EXAMPLE',
        PRIVATE_URL,
        SANDBOX_PATH,
        `AGENT SANDBOX PATH FOR report.pdf: ${SANDBOX_PATH}`,
        `Docs/ (Folder) — library folder ${FOLDER_PATH}`,
        'report.pdf — file_01HZX0000000000000000EXAMPLE',
        `ok.pdf — ${PRIVATE_URL}`,
      ])}`,
      [{ text: 'Look.', fileNames: ['ok.pdf'] }],
    ],
    [
      `Hello.\n\n<attached_files>\nreport.pdf — ${PRIVATE_URL}\nAgent sandbox path: ${SANDBOX_PATH}`,
      [{ text: 'Hello.', fileNames: [] }],
    ],
    [`<Attached_Files>\nreport.pdf — ${PRIVATE_URL}`, []],
  ];
  for (const [text, expected] of cases) {
    const items = projectPublicTranscript([userSays(text)]);
    const shown = items.map((item) => ({
      text: item.text
        .split('\n')
        .filter((line) => line.trim())
        .join('\n'),
      fileNames: item.fileNames,
    }));
    assert.deepEqual(shown, expected, text);
    assertNothingPrivate(items);
  }
  const echoed = projectPublicTranscript([
    {
      id: 'a',
      kind: 'message',
      rawType: 'x',
      role: 'assistant',
      text: `I received:\n\n${block([`report.pdf — ${PRIVATE_URL}`])}`,
    },
  ]);
  assert.deepEqual(echoed[0].fileNames, ['report.pdf']);
  assertNothingPrivate(echoed);
});

test('the share menu shows a live public link even when team sharing is also on', () => {
  const { activeShareChoice } = loadTsx('src/features/chat/hooks/use-session-share.ts', () => ({}));
  assert.equal(activeShareChoice(true, false), 'public');
  assert.equal(activeShareChoice(true, true), 'public');
  assert.equal(activeShareChoice(false, true), 'team');
  assert.equal(activeShareChoice(false, false), 'private');
});

function shareMetadata(folder, session) {
  return loadTsx('src/app/share/[token]/page.tsx', (name) => {
    if (name === '@/lib/brand/identity') return { brand: { name: 'Acme' } };
    if (name === '@/features/files/server') return { resolveShare: async () => folder };
    if (name === '@/features/chat/api/resolve-share')
      return { resolveSessionShare: async () => session };
    if (name === '@/lib/request-context') return { withRequestContext: (_, fn) => fn() };
    if (name === 'react/jsx-runtime' || name === 'next/og') return require(name);
    return {};
  }).generateMetadata({ params: Promise.resolve({ token: 'test-token' }) });
}
const liveSession = {
  status: 'live',
  title: 'Launch checklist',
  workspaceName: 'Orbit studio',
  items: [{ text: 'PRIVATE TRANSCRIPT' }],
};

test('a dead link preview names nothing from the task, and a live one never quotes the transcript', async () => {
  for (const status of ['not_found', 'expired', 'revoked', 'unavailable']) {
    const metadata = await shareMetadata({ status: 'not_found' }, { ...liveSession, status });
    assert.equal(metadata.robots.index, false);
    for (const secret of [liveSession.title, liveSession.workspaceName, 'PRIVATE'])
      assert.ok(!JSON.stringify(metadata).includes(secret), `${status} leaked ${secret}`);
  }
  const live = await shareMetadata({ status: 'not_found' }, liveSession);
  assert.equal(live.title, 'Launch checklist · Orbit studio');
  assert.ok(!JSON.stringify(live).includes('PRIVATE'));
  const expiredFolder = await shareMetadata({ status: 'expired' }, liveSession);
  assert.ok(
    !JSON.stringify(expiredFolder).includes(liveSession.title),
    'an expired folder link fell through to the task',
  );
});
