/** Who may act on a task: only its creator shares, retries or rates it, and every read stays in the caller's workspace. */
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { z } from 'zod';
import { createInitialState } from '../../src/features/chat/lib/chat-state.ts';
import * as turns from '../../src/features/chat/lib/chat-turns.ts';
import * as working from '../../src/features/chat/lib/chat-working.ts';
import * as pending from '../../src/features/chat/lib/reconcile-pending.ts';
import * as queue from '../../src/features/chat/lib/serial-send-queue.ts';
import { assertThreadOwner } from '../../src/features/chat/lib/share-authz.ts';
import * as liveCache from '../../src/features/sessions/api/session-live-cache.ts';
import * as tenant from '../../src/lib/tenant-id.ts';
import { loadTsx } from '../support/load-tsx.mjs';

const require = createRequire(import.meta.url);

test("a teammate cannot share another member's task, and cannot tell it exists", () => {
  assert.equal(assertThreadOwner({ id: 'row-1', createdByUserId: 'owner' }, 'owner', {}), 'row-1');
  for (const row of [{ id: 'row-1', createdByUserId: 'owner' }, undefined])
    assert.throws(
      () => assertThreadOwner(row, 'teammate', { anthropicSessionId: 'sesn_x' }),
      (error) => error.code === 'SESSION_NOT_FOUND',
    );
});

const shell = ({ children }) => React.createElement('div', null, children);
const { ChatRetryContext, useChatRetry } = loadTsx(
  'src/features/chat/components/chat-retry-context.tsx',
  require,
);
const { ErrorRow } = loadTsx('src/features/chat/components/error-row.tsx', (name) => {
  if (name === 'react' || name === 'react/jsx-runtime') return require(name);
  if (name === 'next/link') return shell;
  if (name === 'sonner') return { toast: { error() {} } };
  if (name === '@/components/icons') return { IconAlertCircle: shell };
  if (name === '@/components/ui/button')
    return { Button: ({ children }) => React.createElement('button', null, children) };
  if (name === '@/components/ui/code-block') return { CodeBlock: shell };
  if (name === '@/lib/observability-client') return { captureException() {} };
  if (name === '@/hooks/use-async-action') return { useAsyncAction: () => ({ pending: false }) };
  if (name === './chat-retry-context') return { useChatRetry };
  if (name === './tool-renderers/activity-line') return { ActivityLine: shell, LineBody: shell };
  throw new Error(`Unexpected dependency: ${name}`);
});
const errorRow = (errorType, retry) =>
  renderToStaticMarkup(
    React.createElement(
      ChatRetryContext,
      { value: retry },
      React.createElement(ErrorRow, {
        item: { type: 'error', text: 'failed', errorType, retryStatus: 'exhausted' },
      }),
    ),
  );

test("a reader of a shared task is offered neither Retry nor Reconnect for the owner's apps", () => {
  const owner = async () => {};
  assert.match(errorRow('model_overloaded', owner), /Retry/);
  assert.match(errorRow('mcp_authentication_failed_error', owner), /Reconnect app/);
  assert.doesNotMatch(errorRow('model_overloaded', null), /Retry/);
  assert.doesNotMatch(errorRow('mcp_authentication_failed_error', null), /Reconnect app/);
});

test('the rating route refuses a teammate before anything reaches the agent', async () => {
  const submissions = [];
  const { POST } = loadTsx('src/app/api/sessions/[id]/feedback/route.ts', (name) => {
    if (name === 'next/headers') return { headers: async () => new Headers() };
    if (name === 'zod') return { z };
    if (name === '@/features/feedback/server')
      return { submitMessageFeedback: async (input) => submissions.push(input) };
    if (name === '@/features/sessions')
      return {
        // Only the write gate refuses a teammate; a read gate would let the rating through.
        async authorizeSessionWrite() {
          throw new Error('SESSION_NOT_WRITABLE');
        },
        async authorizeSessionRead() {
          return { userId: 'teammate', createdByUserId: 'owner' };
        },
        sessionRouteErrorResponse() {},
      };
    if (name === '@/lib/route-kit')
      return {
        withApiRoute: (_options, handler) => handler,
        parseRouteParams: async (params) => params,
        parseJsonBody: async (request, schema) => schema.parse(await request.json()),
      };
    throw new Error(`Unexpected dependency: ${name}`);
  });
  const request = new Request('http://localhost/', {
    method: 'POST',
    body: JSON.stringify({ eventId: 'evt', rating: 'down', final: true }),
  });
  await assert.rejects(POST(request, { params: { id: 'task' } }), /SESSION_NOT_WRITABLE/);
  assert.deepEqual(submissions, []);
});

test("a running task is published under the organization's key, never the internal workspace id", () => {
  const client = new QueryClient();
  const effects = [];
  const state = { ...createInitialState(), status: 'running' };
  const dependencies = {
    react: {
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
      useRef: (current) => ({ current }),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: (effect) => effects.push(effect),
    },
    '@tanstack/react-query': { useQueryClient: () => client },
    '@/lib/tenant-id': tenant,
    '@/lib/fetch-json': {},
    '@/lib/observability-client': {},
    '@/features/sessions/api/session-live-cache': liveCache,
    '@/features/files/hooks/use-session-artifacts': {
      useSessionArtifacts: () => ({ state: { artifacts: [] } }),
    },
    '../api/use-chat-context': { useChatContext: () => ({}) },
    '../lib/attachment-mount-cache': { clearMountedAttachmentsForSession() {} },
    '../lib/chat-turns': turns,
    '../lib/chat-working': working,
    '../lib/reconcile-pending': pending,
    '../lib/serial-send-queue': queue,
    './use-chat-browser': { useChatBrowser() {} },
    './use-chat-credit-pause': { useChatCreditPause: () => ({ pausedNoCredits: false }) },
    '@/hooks/use-async-action': { useAsyncAction: () => ({ pending: false }) },
    './use-chat-send': { useChatSend: () => ({}) },
    './use-event-stream': {
      useEventStream: () => ({ state, status: 'open', meta: {}, replaySettled: true }),
    },
    './use-pending-sends': { usePendingSends: () => ({ pending: [] }) },
    './use-tool-decisions': {
      useToolDecisions: () => ({
        decisions: { pending: new Map(), canDecide: true, resolve() {} },
        autoDispatchToolUseIds: new Set(),
      }),
    },
  };
  const { useChatViewState } = loadTsx('src/features/chat/hooks/use-chat-view-state.ts', (name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  });
  const organizationId = tenant.organizationIdSchema.parse('organization-a');
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  useChatViewState({
    organizationId,
    suppliedWorkspaceId: workspaceId,
    sessionId: 'task',
    suppliedSession: null,
    loadContext: false,
  });
  const cleanups = effects.map((effect) => effect());
  const key = liveCache.sessionDispatchKeys.workspace(organizationId);
  assert.deepEqual(client.getQueryData(key), { task: true });
  assert.equal(client.getQueryData(['sessions', workspaceId, 'dispatch-activity']), undefined);
  for (const cleanup of cleanups) cleanup?.();
  assert.deepEqual(client.getQueryData(key), {});
  client.clear();
});

test("the task page reads its session through the signed-in caller's workspace", async () => {
  const lookups = [];
  globalThis.__chatContextLookups = lookups;
  const stub = (source) => ({
    url: `data:text/javascript,${encodeURIComponent(source)}`,
    shortCircuit: true,
  });
  const stubs = {
    'next/headers': 'export const headers=async()=>new Headers();',
    '@/lib/request-context': 'export const withRequestContext=(_ctx,run)=>run();',
    './thread-members': 'export const loadThreadMembers=async()=>[];',
    '@/features/files/server': 'export const uploadConfig=()=>({enabled:false});',
    '@/lib/caller':
      "export const resolveCaller=async()=>({workspaceId:'workspace',organizationId:'org',userId:'viewer'});",
    '@/features/session-runtime':
      "export const getWorkspaceSession=async input=>{globalThis.__chatContextLookups.push(input);return {id:input.sessionId,visibility:'workspace'};};",
    '@/features/sessions':
      "export const loadSessionStatus=async()=>({status:'running',pausedReason:null});",
  };
  registerHooks({
    resolve: (specifier, context, next) =>
      specifier in stubs ? stub(stubs[specifier]) : next(specifier, context),
  });
  const { loadChatContext } = await import('../../src/features/chat/api/load-chat-context.ts');
  const context = await loadChatContext('session');
  assert.deepEqual(lookups, [
    { sessionId: 'session', workspaceId: 'workspace', viewerId: 'viewer' },
  ]);
  assert.equal(context.workspaceId, 'workspace');
});
