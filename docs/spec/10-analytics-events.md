# Product analytics events

This doc is the standard for how product events are named, given properties, captured and delivered. The catalog is the registry in [`src/lib/analytics-events.ts`](../../src/lib/analytics-events.ts). Errors and logs are a separate pipeline ([04-observability.md](04-observability.md)).

Goal: a contributor or a coding agent answers product questions from PostHog without reading the code. PostHog's query surfaces (HogQL and its MCP server at `mcp.posthog.com/mcp`) see three things: the event name, its properties and its Data Management description. This standard exists to make those three readable.

---

## 1. Deliberate events, not autocapture

Autocapture is off. `src/instrumentation-client.ts` sets `autocapture: false` and `capture_pageview: false`, then sends `$pageview` once on load and on each router transition. Autocapture records clicks and other DOM activity ([PostHog docs](https://posthog.com/docs/product-analytics/autocapture)), which buries named facts under selectors.

An event earns its place when it answers a question about activation, retention, revenue or a funnel someone acts on. If nobody would build a dashboard or make a decision from it, do not send it.

## 2. One registry, enforced by types

Every product event is a key of `ANALYTICS_EVENTS` in `src/lib/analytics-events.ts`. A capture call accepts only a registered name, so an unregistered name is a compile error. Each entry has:

| Field | Meaning |
|---|---|
| `description` | The sentence an agent reads to know when the event fires. The same text goes into PostHog Data Management (§8). |
| `side` | `'server'` or `'client'`: the one runtime that captures it (§5). |
| `conversion` | `true` on a revenue moment; omitted otherwise. |

Capture goes only through `captureEvent()` from `src/lib/analytics.ts` (server) or `src/lib/analytics-client.ts` (browser). A raw `posthog.capture(` call outside those files fails lint (`no-restricted-syntax` in `eslint.config.mjs`).

Every event also has a plain-language explanation in `EVENT_EXPLANATIONS` (`src/features/admin/analytics/lib/event-explanations.ts`), which the admin analytics page shows. It is keyed by the registry, so a new event without an explanation is a compile error.

The type check enforces the category and verb grammar in §3: a registry key whose category is not in `EventCategory`, or whose last `_` token is not in `EventVerb`, fails `pnpm typecheck`. `side` and `conversion` are typed. Lowercase snake_case and a useful description are kept by review.

## 3. Naming grammar

This follows PostHog's naming guidance ([best practices](https://posthog.com/docs/product-analytics/best-practices)): lowercase snake_case, present-tense verbs, fixed strings and the `category:object_action` framework.

```
<category>:<object>_<action>     session:message_send, team:invite_accept
<category>:<action>              when the object is the category: workspace:create
```

- `category` is one of `EventCategory` in the registry file. Categories are singular product domains. Adding one is a change to that union, never a choice made at a call site.
- `action` is the last `_`-separated token and one of `EventVerb` in the registry file. Present tense.
- `object` is the noun between them. Leave it out only when it equals the category.
- Never build a name from values. A dimension such as a skill slug is a property (`skill_slug`).
- The dot.case names in `src/features/notifications/lib/events.ts` are notification events, a different vocabulary. Do not mix them.

## 4. Properties

Naming follows the same PostHog guidance: `object_adjective` (`credit_amount`, `session_kind`), booleans prefixed `is_` or `has_`, and dates suffixed `_date` (date only) or `_timestamp` (an instant). Values: ISO 8601 UTC for times, integer cents for money (`amount_cents`).

| Goes in | Never goes in |
|---|---|
| Entity IDs beyond the envelope | Personal data: emails, names, message, prompt or file content, any free text a user typed |
| Low-cardinality enums (`session_kind: 'chat' \| 'task'`) | Secrets, tokens, keys |
| Counts and amounts | Raw error messages (they belong to the error pipeline) |
| The `is_` and `has_` facts a funnel splits on | Full URLs with query strings (use the route path) |
| Person properties through `$set` or `$set_once`, on the event that makes them true ([posthog-node docs](https://posthog.com/docs/libraries/node)) | Generated property keys, high-cardinality values, copies of envelope fields |

The redaction rules of [04 §10](04-observability.md#10-what-makes-an-error-message-readable-by-an-agent) apply.

The server envelope is automatic. `buildEventProperties` (`src/lib/observability-properties.ts`) adds `environment`, `request_id`, `trace_id`, `workspace_id`, `organization_id`, `user_id`, `session_id`, `feature`, `op` and `route` from the request context. Call sites add only facts specific to the event. Browser events get posthog-js's own context (URL, session, device) and the `environment` registered at init; a browser call site adds `workspace_id` when it knows it.

When no user is in the request context, the call site passes identity: `captureEvent(name, props, { userId, workspaceId })`. Explicit identity wins over the context. Stripe sends no user, so billing events are attributed to the workspace owner through `workspaceOwnerUserId` in `src/lib/workspace-identity.ts`. A server capture with no user at all is skipped, never sent without a person.

## 5. One owner per event, captured when the fact is durable

The server owns an event whenever a server code path makes the fact true. Server capture survives ad blockers and closed tabs, carries the full envelope and can be tested. Client events are for intent that never reaches the server. The registry's `side` names the owner. Never capture the same fact on both sides.

Capture fires when the fact becomes durable:

- Server: in the feature `api/` function or webhook, after the database write or external confirmation succeeds, and behind the idempotency guard, so a replayed webhook does not capture twice. Never in a route file and never before the write.
- Client: in the handler for the user's action.
- One fact, one capture. Retries, replays and backfills never capture again.

## 6. Delivery

posthog-node buffers events, and a frozen serverless function drops the buffer. PostHog's serverless guidance is to flush per request ([node docs](https://posthog.com/docs/libraries/node)).

`captureEvent` never flushes on its own, never throws into the caller and does nothing without a key. Events go out with the boundary flush described in [04 §11.3](04-observability.md#113-instrumentation-and-flushing): `withApiRoute` schedules `flushObservability()` in Next's `after()` for every route, including webhooks, crons and the session stream. `runAction` does not flush, so captures from server actions go out with the next flush or batch timer in that instance.

## 7. Identity

- `PostHogIdentify` (`src/components/providers/posthog-identify.tsx`, mounted by the app providers) calls `posthog.identify(userId)` when the signed-in user changes ([identify docs](https://posthog.com/docs/product-analytics/identify)). It keeps anonymous-to-user stitching and resets first only when a different identified account signs in. Server events use `distinctId = user_id`, so both sides land on one person.
- `resetIdentity()` in `src/lib/analytics-client.ts` calls `posthog.reset()`. Every sign-out surface calls it: the sidebar footer, account deletion and the invite account switch. PostHog recommends a reset on every logout.
- The workspace is both a property (`workspace_id`) and a PostHog group (`groups: { workspace: <workspace id> }`) on every server event that has one. The group does nothing until group analytics is enabled, which is a paid add-on ([group docs](https://posthog.com/docs/product-analytics/group-analytics)). Dashboards break down by the `workspace_id` property, so nothing depends on the add-on.

## 8. PostHog Data Management

PostHog's MCP server answers questions from event names, properties and Data Management metadata, so that metadata is the interface agents read.

- Copy each registry `description` into the event's Data Management description, tagged `source: code-registry`, when the event first ships. This step is manual.
- Mark an event Verified in Data Management once it is observed in production.
- [Actions](https://posthog.com/docs/data/actions) are free to compose in PostHog. They are never stored in the repo and never replace a properly named event.

## 9. The catalog

The registry is the catalog. This doc does not list events.

## 10. Adding an event

1. Show that it passes the §1 bar: name the question it answers in the pull request description.
2. Add the registry entry: a name in the §3 grammar, a description an agent can act on, `side`, and `conversion` if it is revenue.
3. Add its explanation to `EVENT_EXPLANATIONS`.
4. Capture it at the durable moment (§5) through `captureEvent`, with properties that follow §4.
5. Run the drift test (`pnpm test:unit`). Grammar violations fail CI.
6. After the first production sighting, copy the description into Data Management and mark the event Verified (§8).

## 11. Dashboards, insights and alerts

These are code in `src/features/admin/analytics/lib/`: dashboards and their insights in `analytics-dashboard-templates.ts`, alerts in `analytics-alert-templates.ts`, assembled for one deploy environment by `buildAnalyticsDefinitions` in `analytics-dashboards.ts`. `pnpm posthog:sync` (needs `POSTHOG_API_KEY` and `POSTHOG_PROJECT_ID`; `--environment` picks the deploy) creates or updates them by name and never deletes anything. Dashboards and insights carry the tag `just-a-wrapper` (`MANAGED_TAG` in `analytics-query.ts`), and the sync updates only tagged ones. Alerts have no tags, so the sync matches them by name. It writes `analytics-sync-record.json`, which the admin analytics page reads.

`tests/lib/analytics.test.mjs` checks that every insight uses registered events, every alert points at a real trends series, and the chosen environment filters every insight.

Browser ingest goes through the `/ingest` reverse proxy defined in `next.config.ts`, so ad blockers do not drop it.
