import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const sourceRoot = new URL('../../src/', import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolution = nextResolve(specifier, context);
    const resolved = resolution.url;
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true };
    }
    if (specifier === 'next/server') {
      return {
        url: 'data:text/javascript,export const after = (fn) => { globalThis.__relayAfterPromise = Promise.resolve().then(fn) }',
        shortCircuit: true,
      };
    }
    if (resolved === new URL('features/agents/index.ts', sourceRoot).href) {
      return {
        url: 'data:text/javascript,export const getAnthropicClient = () => globalThis.__relayTestClient',
        shortCircuit: true,
      };
    }
    if (
      resolved === new URL('features/files/api/sweep-session-artifacts.ts', sourceRoot).href ||
      resolved === new URL('features/billing/api/accrue-model-request.ts', sourceRoot).href ||
      resolved === new URL('features/billing/api/accrue-session-end.ts', sourceRoot).href ||
      resolved ===
        new URL('features/billing/api/accrue-usage-reconciliation.ts', sourceRoot).href ||
      resolved === new URL('features/notifications/api/notify-task-events.ts', sourceRoot).href
    ) {
      return {
        url: 'data:text/javascript,export const sweepSessionArtifacts=()=>{};export const accrueModelRequest=(input)=>globalThis.__relayAccrueModelRequest?.(input);export const accrueSessionEnd=(sessionId,input)=>globalThis.__relayAccrueSessionEnd?.(sessionId,input);export const accrueUsageReconciliation=(input)=>globalThis.__relayAccrueUsageReconciliation?.(input);export const notifyIntegrationBroken=()=>{}',
        shortCircuit: true,
      };
    }
    if (resolved === new URL('lib/logger.ts', sourceRoot).href) {
      return {
        url: 'data:text/javascript,export const shipLog=(entry)=>globalThis.__relayShipLog?.(entry)',
        shortCircuit: true,
      };
    }
    if (resolved === new URL('lib/observability.ts', sourceRoot).href) {
      return {
        url: 'data:text/javascript,export const captureException=(error)=>globalThis.__relayCaptureException?.(error)',
        shortCircuit: true,
      };
    }
    if (resolved === new URL('lib/analytics.ts', sourceRoot).href) {
      return {
        url: 'data:text/javascript,export const captureEvent=()=>{}',
        shortCircuit: true,
      };
    }
    if (resolved === new URL('lib/request-context.ts', sourceRoot).href) {
      return {
        url: 'data:text/javascript,export const snapshotCtx=()=>({});export const withRequestContext=(_snapshot,fn)=>Promise.resolve().then(fn)',
        shortCircuit: true,
      };
    }
    if (resolved === new URL('lib/errors.ts', sourceRoot).href) {
      return {
        url: 'data:text/javascript,export class AppError extends Error { constructor(code,message){super(message);this.code=code} };export class BillingError extends AppError {}',
        shortCircuit: true,
      };
    }
    if (resolved === new URL('features/sessions/api/turn-analytics.ts', sourceRoot).href) {
      return {
        url: "data:text/javascript,export const captureCompletedTurn=async(input)=>{globalThis.__relayObservations.turns.push(input);return 'captured'}",
        shortCircuit: true,
      };
    }
    if (resolved === new URL('features/sessions/api/mirror.ts', sourceRoot).href) {
      return { url: 'data:text/javascript,export const mirrorEvent=()=>{}', shortCircuit: true };
    }
    if (resolved === new URL('features/sessions/api/session-search-text.ts', sourceRoot).href) {
      return {
        url: 'data:text/javascript,export const reconcileSessionSearchText=(input)=>globalThis.__relayReconcileSearchText?.(input)',
        shortCircuit: true,
      };
    }
    if (resolved === new URL('features/sessions/api/sync-session-status.ts', sourceRoot).href) {
      return {
        url: 'data:text/javascript,export const syncSessionStatus=(input)=>globalThis.__relayObservations.statuses.push(input)',
        shortCircuit: true,
      };
    }
    return resolution;
  },
});

const { sessionEventStream } = await import(
  '../../src/features/session-runtime/api/session-event-relay.ts'
);
const { reduceEvent } = await import('../../src/features/chat/lib/chat-store.ts');
const { createInitialState } = await import('../../src/features/chat/lib/chat-state.ts');
const { selectPendingGates } = await import('../../src/features/chat/lib/chat-turns.ts');
const { safeParseRelayFrame } = await import('../../src/features/chat/lib/relay-frame-schema.ts');

const GATED_TOOL = {
  id: 'sevt_gate',
  type: 'agent.mcp_tool_use',
  name: 'GMAIL_FETCH_EMAILS',
  mcp_server_name: 'composio',
  input: { max_results: 5 },
  evaluated_permission: 'ask',
};

const CONFIRMATION = {
  id: 'sevt_confirmation',
  type: 'user.tool_confirmation',
  tool_use_id: GATED_TOOL.id,
  result: 'allow',
};

function installClient({
  live = [],
  history = [],
  reconciledHistory = history,
  reconciledPages = [reconciledHistory],
  sendError = null,
  streamOpen,
  iterator,
}) {
  globalThis.__relayAfterPromise = Promise.resolve();
  globalThis.__relayCaptureException = undefined;
  globalThis.__relayAccrueModelRequest = undefined;
  globalThis.__relayAccrueSessionEnd = undefined;
  globalThis.__relayAccrueUsageReconciliation = undefined;
  globalThis.__relayReconcileSearchText = undefined;
  globalThis.__relayShipLog = undefined;
  const observations = {
    aborted: false,
    statuses: [],
    turns: [],
    sent: [],
    sendOptions: [],
    listCalls: [],
    reconciledPagesIterated: 0,
  };
  globalThis.__relayObservations = observations;
  let listCalls = 0;
  globalThis.__relayTestClient = {
    beta: {
      sessions: {
        events: {
          async stream() {
            if (streamOpen) return streamOpen();
            if (iterator)
              return {
                controller: {
                  abort() {
                    observations.aborted = true;
                  },
                },
                [Symbol.asyncIterator]: () => iterator,
              };
            return {
              controller: {
                abort() {
                  observations.aborted = true;
                },
              },
              async *[Symbol.asyncIterator]() {
                yield* live;
              },
            };
          },
          list(sessionId, params, options) {
            const callIndex = listCalls++;
            const pages = callIndex === 0 ? [history] : reconciledPages;
            observations.listCalls.push({ sessionId, params, options });
            return {
              data: pages[0] ?? [],
              async *[Symbol.asyncIterator]() {
                for (const page of pages) {
                  if (callIndex > 0) observations.reconciledPagesIterated += 1;
                  yield* page;
                }
              },
            };
          },
          async send(_sessionId, body, options) {
            observations.sent.push(body.events[0]);
            observations.sendOptions.push(options);
            if (sendError) throw sendError;
          },
        },
      },
    },
  };
  return observations;
}

async function readFrames(
  resolveGate,
  { lastEventId = null, signal = new AbortController().signal } = {},
) {
  const response = sessionEventStream({
    sessionId: 'session_test',
    lastEventId,
    signal,
    traceId: 'trace_test',
    resolveGate,
  });
  const payload = await new Response(response).text();
  await globalThis.__relayAfterPromise;
  const decoded = payload
    .split('\n\n')
    .map((frame) => frame.match(/^data: (.+)$/m)?.[1])
    .filter(Boolean)
    .map(JSON.parse);
  return decoded.map((value) => {
    const parsed = safeParseRelayFrame(value);
    assert.equal(parsed.ok, true);
    return parsed.frame;
  });
}

export {
  CONFIRMATION,
  createInitialState,
  GATED_TOOL,
  installClient,
  readFrames,
  reduceEvent,
  selectPendingGates,
};
