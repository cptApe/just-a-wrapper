# Observability and error handling

Goal: when something breaks, a coding agent can read the errors and logs, find the cause and fix it without help. This doc names the contracts and the file that holds each one. Product analytics is a separate pipeline, described in [10-analytics-events.md](10-analytics-events.md).

---

## 1. Tools

PostHog is the only observability tool. One project holds errors, logs and product analytics, so one `trace_id` joins them in one HogQL query and one MCP server (`mcp.posthog.com`) reaches all three. The cost is that there is no APM waterfall: correlation is a query, not a rendered trace.

| Surface | Job | Wired in |
|---|---|---|
| PostHog Error Tracking | Exceptions, issue grouping, alerts. Source maps upload through `withPostHogConfig` from `@posthog/nextjs-config`. | `next.config.ts`, `src/lib/observability.ts` (server), `src/lib/observability-client.ts` (browser) |
| PostHog Logs | Structured log records, exported over OTLP-HTTP to `${POSTHOG_HOST}/i/v1/logs`. There is no Vercel Log Drain in the path. | `src/lib/otel-logs.ts`, `src/lib/logger.ts` |
| PostHog product analytics and session replay | Named product events and browser replay. | [10-analytics-events.md](10-analytics-events.md) |

PostHog does not instrument `@anthropic-ai/sdk`. Managed Agents events reach PostHog only through the relay mirror in §6.

Everything is a no-op without `POSTHOG_PROJECT_KEY` (server) or `NEXT_PUBLIC_POSTHOG_KEY` (browser). Without a key, `captureException` writes to the console instead.

---

## 2. Error types

Every throw in `src/` is an `AppError` subclass from [`src/lib/errors.ts`](../../src/lib/errors.ts). The reasons are in [decision 0008](../decisions/0008-typed-errors-and-no-silent-catches.md).

- `code` is one of `ERROR_CODES` in the same file. It is stable, so a grep for the code finds every throw site.
- `context` holds the IDs and inputs that help debugging. Never put secrets in it.
- `cause` keeps the original error as the native ES2022 cause. Never drop it.
- Subclasses: `ToolError`, `IntegrationError`, `CapabilityOffError`, `BillingError`, `WebhookError`, `AuthorizationError` (403, default code `FORBIDDEN`) and `PortalUnavailableError`.
- The lint rule `no-bare-error-throw` ([`eslint-rules/no-bare-error-throw.mjs`](../../eslint-rules/no-bare-error-throw.mjs)) rejects `throw new Error(...)`, `TypeError` and `RangeError`.

`serializeError` turns any thrown value into a redacted record. `exceptionFromRecord` rebuilds a native `Error` from that record, so error tracking groups correctly without ever receiving the original object and its secrets.

---

## 3. Request context

[`src/lib/request-context.ts`](../../src/lib/request-context.ts) keeps one `RequestContext` per request in Node's `AsyncLocalStorage`. The logger, `captureException` and `captureEvent` read it, so every log line, exception and server event carries `request_id`, `trace_id`, `route` and, when known, `workspace_id`, `organization_id`, `user_id`, `session_id`, `task_id`, `feature` and `op`.

| Function | Contract |
|---|---|
| `withRequestContext(seed, fn)` | Opens a context. Mints `request_id` and a W3C `trace_id` unless the seed supplies them. |
| `ctx()` | Returns the context or `undefined`. |
| `requireCtx()` | Returns the context or throws `UNEXPECTED`. |
| `extend(patch)` | Adds fields to the open context. Throws when no context is open, because a silent no-op loses the patch. |
| `snapshotCtx()` | Copies the context so background work can reopen it with `withRequestContext(snapshot, ...)`. |

Each entry point opens its own context:

| Entry point | Opens context through |
|---|---|
| API routes, cron routes, webhooks, the Better Auth route | `withApiRoute` in [`src/lib/route-kit.ts`](../../src/lib/route-kit.ts) |
| Server actions | `runAction` in [`src/lib/action-state.ts`](../../src/lib/action-state.ts) ([decision 0026](../decisions/0026-one-server-action-boundary.md)) |
| Framework errors that escape every boundary | `onRequestError` in `src/instrumentation.ts` |

The lint rule `require-request-context` fails any `src/app/api/**/route.ts` handler that calls neither `withRequestContext` nor `withApiRoute`.

Context set in `src/proxy.ts` does not reach route handlers. Open the context in the handler.

---

## 4. No silent failures — enforced

1. The lint rule `no-silent-catch` ([`eslint-rules/no-silent-catch.mjs`](../../eslint-rules/no-silent-catch.mjs), tested in `tests/eslint-rules/no-silent-catch.test.mjs`) requires every `catch` block and every `.catch(callback)` to contain a `throw` or a call whose name ends in `captureException`, anywhere in its body. A logger call alone does not count.
2. Server code catches at boundaries. Feature code lets errors propagate.

   | Boundary | What it does with a thrown error |
   |---|---|
   | `withApiRoute` | Captures it (except expected user-state errors, unless `reportExpectedErrors` is set), ships a `route.failed` log (at `info` for an expected error, `error` otherwise) and returns the mapped error response. |
   | `runAction` | Captures it (unless the boundary's `expected` callback says it is a user-fixable error) and returns `ActionState` with a safe message. |
   | `onRequestError` | Captures render and route errors that escaped every boundary, then flushes. |
   | `registerGlobalErrorHandlers` in `src/lib/observability.ts` | Captures `uncaughtException` and `unhandledRejection`. |

   Client components may catch to drive their error state. The lint rule still requires the catch to capture or rethrow.

---

## 5. Cross-system correlation — one trace_id everywhere

`trace_id` is the only correlation key. It must be a W3C trace-id: 32 lowercase hex characters, not all zero. A `randomUUID()` is not one, and OTLP tooling does not recognise it. [`src/lib/trace.ts`](../../src/lib/trace.ts) holds `newTraceId()` and `parseTraceparent(header)`, which returns the trace-id from a valid `traceparent` header and `undefined` otherwise.

Where the `trace_id` travels:

| Place | How |
|---|---|
| Every exception, log line and server event | Copied from the request context by `buildEventProperties` ([`src/lib/observability-properties.ts`](../../src/lib/observability-properties.ts)) and by the logger. |
| Browser | The session stream (`src/app/api/sessions/[id]/stream/route.ts`) sends a `meta` frame with `traceId`, which the chat connection state keeps. |
| Anthropic webhooks | `src/app/api/webhooks/anthropic/route.ts` adopts the trace-id from an inbound `traceparent` header when one is present. |

Every exception and server event also carries `environment` (`development`, `preview` or `production`, from `VERCEL_ENV`).

---

## 6. Anthropic event stream mirroring

[`src/features/sessions/api/mirror.ts`](../../src/features/sessions/api/mirror.ts) ships each relayed Managed Agents event to PostHog Logs as an `sse.mirror` record. The relay schedules it as background work in `src/features/session-runtime/api/schedule-relay-effects.ts`, so a mirror failure never blocks or breaks the chat stream.

- Sampling: every `agent.tool_use`, `agent.mcp_tool_use`, `agent.custom_tool_use`, `span.*`, `session.status_*` and `session.error` event is kept. Other events, such as message and thinking deltas, are sampled at 1%.
- The event payload passes through `sanitize()` in `src/lib/sanitize.ts` before shipping, because tool payloads can contain file contents and email bodies.
- The record carries an allowlist of context fields, not the whole context.

A HogQL query on `session_id` over `sse.mirror` records returns what the agent did in that session.

---

## 7. Tool execution traces

A custom-tool dispatch is its own request (`POST /api/custom-tools/dispatch`) with its own `trace_id`. Join it to the chat through the session: the dispatch resolves the session row, and the `tool:call_complete` and `tool:call_fail` events carry `tool_name`, `duration_ms`, `credits` and `failure_kind`. Dispatcher captures carry `toolUseId`, which is Anthropic's event ID for the call.

---

## 8. Replay

| Question | Where to look |
|---|---|
| What did the user see in the browser? | PostHog session replay, when it is enabled in the PostHog project. |
| What did the agent do? | PostHog Logs, `sse.mirror` records filtered by `session_id` (§6). |
| What did the agent's browser do? | `GET /api/sessions/[id]/replays` and `/replays/[pageId]`, which proxy Browserbase recordings for an authorized session. |

---

## 9. Log record fields

`logger()` and `shipLog()` in [`src/lib/logger.ts`](../../src/lib/logger.ts) write one JSON line to stdout. `shipLog()` also emits the same record to PostHog Logs. A record has:

- `level` (`info`, `warn` or `error`), `msg` and an ISO 8601 timestamp.
- The request-context fields from §3.
- Optional `feature`, `op`, `duration_ms` and `error`. An `error` is serialized with `serializeError`.
- Any other call-site field. The OTLP copy flattens objects to JSON strings, because OTLP log attributes are flat.

Query by `msg`, `feature`, `op` or any context field. Exceptions carry the same `feature`, `op` and `trace_id` as properties, so one `trace_id` joins both.

---

## 10. What makes an error message readable by an agent

- A code, not prose: `TOOL_INPUT_INVALID`, not "validation failed".
- Text that says what to do: name the missing connection and where to reconnect it.
- The inputs: the full `ZodError.flatten()` output, not only the first message.
- The cause chain, kept through `cause`.
- No personal data or secrets. Every sink redacts through [`src/lib/sanitize.ts`](../../src/lib/sanitize.ts): sensitive keys, credential-bearing URLs, email addresses, bearer tokens and API-key patterns, with size limits on strings and objects. The session event mirror uses the same sanitizer with `truncateAt`, so long tool payloads keep only a sample.

---

## 11. Boundaries in code

### 11.1 Custom-tool dispatcher

Provider contract ([Managed Agents event stream](https://platform.claude.com/docs/en/managed-agents/events-and-streaming)): a custom tool call arrives as `agent.custom_tool_use`. The session goes idle with `stop_reason.type: requires_action` and lists the blocking event IDs in `stop_reason.event_ids`. It stays paused until each one is answered with `user.custom_tool_result`, whose `custom_tool_use_id` is the event ID. A second result for the same call is accepted and has no effect. Anthropic's `user.tool_confirmation` answers agent and MCP tool calls, so approval for custom tools is this app's job.

Rule: every claimed call ends with a posted result, success or failure. A missing result leaves the session paused.

Entry points: `POST /api/custom-tools/dispatch` from the browser (`dispatchRequest`), and the session-actions path (`src/features/tools/api/dispatch-session-actions.ts`). Both call `dispatchSessionToolCalls` in [`src/features/tools/api/dispatch-request.ts`](../../src/features/tools/api/dispatch-request.ts). The order is an invariant:

1. Check that each call is still pending upstream and read its input.
2. Decide a gate per call (`prepareCustomToolDispatchGates` in `dispatch.ts`). Tools act as the session's creator. If the creator may no longer act (`assertSessionActor`: no longer a member, or demoted on a task that writes workspace memory), every call gets a `FORBIDDEN` result. Otherwise `decideBuiltinToolGate` (`src/features/permissions/lib/resolve.ts`) reads the creator's tool policy: Block refuses, Ask parks, Allow or no row runs, and a tool marked `alwaysAsk` parks even under Allow. The Tools page shows each row through the same function.
3. Claim the whole batch in one transaction (`claimAnthropicCustomToolCalls` in `tool-delivery-transitions.ts`), writing a `custom_tool_dispatch` row per call and a `pending_confirmation` row per parked call. A parked call's row is born `awaiting_decision`. Claims happen before any handler runs and survive handler failure, because repeating an unknown external side effect is unsafe. A call another request already claimed comes back as a value, not an error, and recovers its stored delivery instead (`dispatch-recovery.ts`).
4. Run each call (`dispatchBatch`, concurrently). An unknown tool returns `TOOL_NOT_FOUND`, invalid input returns `TOOL_INPUT_INVALID`, and Block returns a plain refusal with `isError: false` so the model relays it rather than retrying. A run goes through `runAndPost` in `dispatch-execution.ts`, which re-checks the actor, runs the handler and turns a thrown error into an error result. A tool that fails after its provider charged throws `PaidToolError` (`tools/lib/paid-tool-error.ts`) with the cost it still owes, a media charge or a known amount, and the failure is billed exactly like a success.
5. Store, then deliver, the result (`storeAndDeliver` in [`tool-delivery.ts`](../../src/features/tools/api/tool-delivery.ts)).

Delivery is a state machine (`toolDeliveryMachine` in `src/features/tools/lib/tool-delivery-machine.ts`):

| Status | Meaning |
|---|---|
| `awaiting_decision` | The call is parked for a person. Only a decision (`claimToolDecision`) or its expiry (`expireToolDecisions`) moves it, so no recovery path can answer a waiting approval. |
| `claimed` | The call is claimed and about to run. |
| `executing` | The handler is running under a five-minute lease (`TOOL_EXECUTION_LEASE_MS`). An expired lease means the outcome is unknown, so recovery posts `EXECUTION_INTERRUPTED` and never reruns the handler. |
| `ready` | The result is stored and waiting to be posted. |
| `delivering` | A post is in flight. Before posting, delivery asks upstream whether the result already arrived. A failed send returns the row to `ready`. |
| `delivered` | Upstream has the result. Credits are accrued next. |
| `completed` | Accrued and finished. The stored content is cleared. The `tool:call_complete` or `tool:call_fail` event fires here. |
| `abandoned` | Upstream no longer has the session or the pending call (404, 410, or not pending). Credits are still accrued and the stored content is cleared. |

Confirmation. `confirmPendingTools` in [`confirm.ts`](../../src/features/tools/api/confirm.ts) (`POST /api/custom-tools/confirm`) takes a session write grant, so only the creator decides. `claimToolDecision` moves the `pending_confirmation` row and the delivery row in one transaction: a deny stores a `USER_DENIED` result, and an allow runs the handler through `runAndPost`. A decision older than 24 hours (`TOOL_DECISION_MAX_AGE_MS`) expires with `CONFIRMATION_EXPIRED`. If the creator has left the workspace, every pending decision ends with `FORBIDDEN`. `listPendingConfirmations` (`GET /api/custom-tools/pending`) reads the queue from the database, so a reload or a second tab sees the same pending calls.

Recovery sweeps: `reconcileToolDeliveries` (run by `/api/cron/billing`) and `recoverRemovedCreatorTools` (run by `/api/cron/recovery`, for creators who can no longer open the task) finish stuck deliveries. Each sweep handles one call at a time. A delivered row is re-claimed through `claimDeliveredRecovery`, and a sweep that loses that claim skips the row.

### 11.2 Webhook handler

Webhook routes use `withApiRoute` with an `errorResponse` that sets the status by whether a retry can help. A permanent failure gets a 4xx so the sender stops. A transient failure gets a 5xx so the sender retries.

| Route | Logic | Status mapping |
|---|---|---|
| `src/app/api/webhooks/anthropic/route.ts` | `src/features/webhooks/anthropic.ts`, `anthropic-verify.ts` | `httpStatusForWebhookError`: `WEBHOOK_SIGNATURE_INVALID` 401, `TOOL_INPUT_INVALID` 400, everything else 500 |
| `src/app/api/webhooks/composio/route.ts` | `src/features/webhooks/composio.ts`, `composio-verify.ts` | The same `httpStatusForWebhookError` |
| `src/app/api/webhooks/stripe/route.ts` | `processStripeWebhook` in `src/features/billing` | `WEBHOOK_SIGNATURE_INVALID` 400, everything else 500, so fulfilment failures stay retryable |

Signature verification reads the raw request body before any JSON parsing.

### 11.3 Instrumentation and flushing

`register()` in [`src/instrumentation.ts`](../../src/instrumentation.ts) runs only on the Node.js runtime. In order, it creates the posthog-node client (`initPostHog`), creates and registers the OTel `LoggerProvider` (`initLoggerProvider` in `otel-logs.ts`), and registers the process-level handlers (`registerGlobalErrorHandlers`). The handlers live in `observability.ts` because referencing `process.on` in `instrumentation.ts` breaks the Edge bundle. `src/instrumentation-client.ts` initializes posthog-js in the browser, through the `/ingest` reverse proxy.

Serverless functions freeze when the response is sent, before batch timers fire. So buffered exceptions, events and log records must be flushed explicitly with `flushObservability()` (`src/lib/observability.ts`), which flushes posthog-node and the log provider.

| Context | Flush |
|---|---|
| `withApiRoute` | Schedules `after(() => flushObservability())` inside the request context before the handler runs, so it runs even when the handler throws. |
| `onRequestError` | Flushes after capturing. |
| `runAction` | Does not flush. Its captures go out with the next flush or batch timer in that instance. |

The browser `captureException` in `observability-client.ts` has the same signature as the server one, so call sites read the same in both runtimes.

### 11.4 Logger

[`src/lib/logger.ts`](../../src/lib/logger.ts):

| Function | Use |
|---|---|
| `logger()` | A pino child bound to the current request context. Writes JSON to stdout. Level from `LOG_LEVEL` (validated in `src/lib/env.ts`). Pass `{ inheritRequestContext: false }` for audit sinks that bind only approved fields. |
| `shipLog(record)` | Writes to stdout and emits the same record to PostHog Logs. Never throws; a failure is captured instead. |
| `logBetterAuth(level, message, ...details)` | The sink for Better Auth's logger. |

The pino instance is created on first use, so import order does not matter. Every field and the final written line pass through `sanitize()`.

### 11.5 Live browser ownership

The agent's live browser has one status, owned by `src/features/tools/lib/browser-machine.ts`:

| Status | Meaning |
|---|---|
| `active` | Open, nobody acting. |
| `acting` | The agent is running a browser action. A user takeover can interrupt it. |
| `user` | The user has control, under a five-minute lease (`BROWSER_CONTROL_LEASE_MS`). An open live panel in control renews it. |
| `closing`, `closed`, `ended` | Shutting down or finished. |

- Only the session creator may control the browser (`authorizeBrowserControl`, a session write grant).
- When the agent's action finishes during a takeover, the user keeps control (`withBrowserAction` in `src/features/tools/api/browser-transitions.ts`).
- Expired control is released the next time the browser is used or its live view is read (`expireBrowserControl`), and the agent is told it may continue. Expired control does not hold the workspace's single browser (`src/features/tools/api/browser-workspace-lock.ts`).
- The live panel polls every five seconds (`src/features/tools/lib/browser-panel-state.ts`), keeps its iframe through failed polls and keeps the debugger URL for the same browser.
- Every Browserbase session is on the session row or on a `browser_candidate` row ([decision 0038](../decisions/0038-every-browser-on-a-row.md)). The candidate is written before the provider create, the provider session carries its id as metadata (`browserCandidateId`), and the candidate goes when the row takes the browser (`claimBrowser`, in the same transaction) or when the browser is released and billed (`settleBrowserCandidate` in `src/features/tools/api/browser-candidates.ts`). The timeout sweep releases and bills every candidate older than ten minutes (`reconcileBrowserCandidates`), finding a session whose id was never stored by its metadata.
- Browser time becomes a charge in one place, `accrueBrowserTime` in `browser-lifecycle.ts`: the one-minute minimum and the one-hour cap from `src/features/billing/lib/browser-session-math.ts`, keyed by the Browserbase id, so a retry or a sweep bills a browser once. Page reads (`browse_page`), task browsers, closes and sweeps all use it.
- Saved sign-in contexts belong to the member who created the task, not to a session, so they survive session deletion (`src/features/tools/api/browser-contexts.ts`). Removing a workspace's contexts first records each one as a cleanup candidate on the workspace. A failed remote deletion keeps the candidate for the next browser open or workspace cleanup.
