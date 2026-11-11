# Patterns

This doc lists the code-level conventions and the file that carries each one. Read the linked file for the shape; this doc does not copy it.

[01-code-standard.md](01-code-standard.md) is the quality bar and wins when the two disagree. [02-foundation.md](02-foundation.md) is the architecture. Reasons live in [the decisions folder](../decisions/README.md).

---

## 1. Feature folder shape

Every folder under `src/features/<feature>/` uses the shape in [code standard 6.1](01-code-standard.md#6-files-and-modules). A feature has only the subfolders it needs.

| Folder or file | Holds |
|---|---|
| `components/` | Every React component of the feature, including dialogs and the top-level view the page imports |
| `hooks/` | React hooks: subscriptions, effects, derived state |
| `api/` | Server code, server actions, React Query hooks and the key factory `keys.ts` |
| `lib/` | Pure functions, state machines and client stores. No React |
| `types.ts`, `constants.ts` | Feature-local types and constants |
| `index.ts`, `server.ts`, `browser.ts` | Public entries (see below) |

When `components/` grows, group files by what they render (`components/browser/`, `components/tool-renderers/`), not by layer.

**`index.ts` exports the feature's public API** — typically the top-level orchestrator components and any hooks other features need. Internal components, helpers, schemas are NOT re-exported. API routes import only `index.ts` or `server.ts`. Other features (from a higher layer of `eslint-rules/feature-layers.mjs`, or later in the same layer) and pages may import a feature's files directly, which keeps client bundles small and avoids barrel cycles. See [code standard 6.2](01-code-standard.md#6-files-and-modules).

**Keep client and server entry points separate when needed.** A client component must not import a feature barrel that also loads server APIs. Files exposes its reusable browser UI through `@/features/files/browser`, a small `'use client'` entry shared by Memory and the chat picker. Its server APIs are in `@/features/files/server`. Chat exposes draft deletion through `@/features/chat/browser` and the message length limit through `@/features/chat/server`; neither entry loads the chat UI. Add a `browser.ts` only when client code must not load the server barrel.

**Overlays** have one registry and one host in `src/app/_overlays/` (`overlay-registry.tsx`, `overlay-host.tsx`). The host mounts once in the `/app` segment layout. See [09-modals.md](09-modals.md).

---

## 2. React Query

React Query holds server data that client components read ([code standard 5.3](01-code-standard.md#5-react)). Page reads that only one server component needs stay in the server component under a `<Boundary>` ([section 14](#14-react-component-patterns)). Streaming transports are not caches: the chat event stream and the workspace SSE channel feed the cache through invalidation and `setQueryData`.

**One client per surface.** `AppDataProviders` in `src/components/providers/app-providers.tsx` creates the `/app` `QueryClient`, mounted by the `/app` segment layout; the admin console mounts its own through `AdminDataProviders`, with the same defaults. Queries default to `staleTime` and `gcTime` of infinity, no refetch on focus or reconnect, and two retries. Live events announce every change, so nothing goes stale on its own. Public and auth routes never mount it.

**One key factory per feature.** Each feature that holds query state has `api/keys.ts`. The root key takes the organization id (`organizationId`, from `useOrganizationId()`), the client's tenant scope, so every cache entry belongs to one workspace. The workspace row id never keys the client cache. The canonical factory is `src/features/sessions/api/keys.ts`.

- On the client the workspace scope is the active `organizationId` from `useOrganizationId()`. The server maps it to the workspace row.
- A workspace switch calls `router.refresh()` and keeps the `QueryClient`. Rooting every key on the workspace is what stops one workspace's cache from serving another.
- Every `invalidateQueries` and `setQueryData` call names a key from a factory. Inline key arrays are not allowed.
- Name keys `all(scope)`, `lists(scope)`, `list(scope, filter)`, `details(scope)`, `detail(scope, id)` as a feature grows.

**Seed from the server.** When a server layout already renders the first page of a list, the hook takes it as `initialData` and does not refetch on mount. The sidebar recents list (`src/features/sessions/api/use-session-list.ts`) is the example.

**A query that may not run** uses `skipToken`, as `src/features/memory/api/use-memory-history.ts` does for an unopened version preview.

---

## 3. React Query mutations

When the result is known in advance, the UI changes before the server answers. `optimisticMutation` in `src/lib/optimistic-mutation.ts` owns that lifecycle. Spread it into `useMutation`. `src/features/skills/api/use-skill-mutations.ts` is a short example.

- `root` is cancelled, snapshotted, restored and invalidated as one unit. Use the feature's workspace root key.
- `apply` writes the expected result and returns anything `onSuccess` needs as `context.applied`, such as a temporary row id.
- `failure` returns the short toast and capture context, or null when the surface reports the failure itself (a conflict banner, a background write).
- `settle` replaces the invalidate when a server component seeds the cache and no fetcher exists. Those lists call `router.refresh()` there.

**Overlapping writes.** Only the newest write on a root may restore its snapshot. Only the last write to finish reconciles. An older failure leaves the screen alone and the final reconcile corrects it.

**Live events never flicker a write back.** SSE handlers call `invalidateUnlessWriting(client, root)`. While a write is in flight the event is dropped, because that write reconciles when it settles.

**Server-rendered props.** Data that only a server component holds uses React's `useOptimistic` inside a transition that calls `router.refresh()`. Move state into React Query only when several client surfaces share it.

**Must wait.** Anything that charges money or changes a plan, sign-in, invitations whose result the server decides, workspace or account deletion, and anything the server generates (a share link, a run). These use `onSettled` alone and show a pending state.

**The recents exception.** `src/features/sessions/api/use-session-mutations.ts` rolls back per field instead of per root, because SSE rewrites recents rows while edits are in flight and a whole-root snapshot would undo a newer live event. `use-create-session.ts` inserts a row under a local id and re-keys it to the real session id on success, so the row stays mounted. `src/features/shell/hooks/use-task-list.ts` turns `session_title` and `session_status` events into `setQueryData` when the event carries the whole row, and into a debounced invalidate when the server must re-derive the list.

### Server actions and reads

- **A mutation called from a form or button is a server action that returns `ActionState` through `runAction`** (`src/lib/action-state.ts`). `runAction` opens request context, reports the failure and returns `{ ok: false, code, message }` because production masks thrown action messages. `message` is the fixed copy for an unexpected error; `appErrorMessage` maps an `AppError` to feature copy; `expected` keeps user-fixable codes out of error tracking. Do not write the `withRequestContext` plus `try`/`catch` result by hand. Workspace actions get these options from `workspaceActionBoundary` in `src/features/workspaces/lib/workspace-error-copy.ts`. See [decision 0026](../decisions/0026-one-server-action-boundary.md).
- **A read is an API route fetched with `fetchJson`, or a server action wrapped in `withRequestContext` that throws.** A throwing read suits a React Query `queryFn`, which turns the throw into its error state. A read never returns `ActionState`.
- **New reads use an API route with `fetchJson`.** Reach for a read action only when a route would duplicate a feature function that already resolves its own caller.
- **Every function exported from a `'use server'` file is a public endpoint**, so each must call `runAction` or `withRequestContext`; `just-a-wrapper/require-action-boundary` enforces it. A helper that takes `Headers` or other server-only input lives in a module without the directive.
- **A domain answer is not an error.** Sign-in eligibility returns `{ status: 'eligible' | 'invalid' | 'no-account' | 'rate-limited' }` (`src/features/auth/types.ts`), not an `ActionState` failure.

---

## 4. Cross-feature invalidation

When one mutation changes data that several features cache, call `invalidateQueries` once per feature, each with that feature's root key.

---

## 5. Route groups + auth guard

The live route tree is `src/app/`.

| Route | Access | Gate |
|---|---|---|
| `/` | Public, also when signed in | None |
| `(auth)` | Public sign-in surface | None |
| `/app` | Signed in, with a live workspace membership | The `(shell)` and `settings` layouts |
| `(admin)` | Operator console | `NEXT_PUBLIC_ENABLE_ADMIN_ROUTES` ([section 6](#6-env-guard-on-operator--dev-surfaces)) |

**Auth is checked in server layouts and server functions, never in the proxy.** `src/proxy.ts` only sets the pathname header and the image Content Security Policy. Next.js advises checking auth in each server function rather than in the proxy ([Next.js data security guide](https://nextjs.org/docs/app/guides/data-security)).

- `src/app/app/layout.tsx` mounts the providers, the overlay host and the command menu above both shells. It does not redirect.
- `src/app/app/(shell)/layout.tsx` calls `loadShellGate` (`src/features/shell/api/load-shell-gate.ts`). A signed-out visitor is redirected to sign-in; a failed read renders `ShellRecovery` and never redirects, because a failed read says nothing about whether the person is signed in.
- `src/app/app/settings/layout.tsx` gates the settings tree the same way.

**One caller resolver.** `src/lib/caller.ts` turns a request into a person and a workspace. See [decision 0025](../decisions/0025-one-caller-resolver.md).

| Function | Returns | Use for |
|---|---|---|
| `resolveUser(headers)` | The signed-in person, or throws `UNAUTHENTICATED` | Surfaces before or outside a workspace |
| `findCaller(headers)` | The caller, or null when there is no live membership | Pages that render a recovery state |
| `resolveCaller(headers, { atLeast })` | The caller, or throws `WORKSPACE_NOT_FOUND` or `FORBIDDEN` | Every workspace read and write |

The active-organization pointer on the auth session can name a workspace the person has left, so `findCaller` always joins the live membership and workspace. Roles and their order live in `src/lib/workspace-role.ts`. `just-a-wrapper/no-direct-session-read` bans `auth.api.getSession` and `activeOrganizationId` everywhere except the files listed in `eslint.config.mjs`: the two resolvers (`caller.ts` and `src/lib/request-session.ts`, the per-render cached read from [decision 0013](../decisions/0013-per-request-cache-for-session-and-workspace.md)) and the three modules that move the active-organization pointer.

**Access grants.** A caller is not enough to act on a resource. The grant is checked in one place per resource.

| Resource | Rule | Enforced in |
|---|---|---|
| Session (task chat) | Reads take a `SessionReadGrant`; write functions accept only the branded `SessionWriteGrant` | `src/features/sessions/api/session-access.ts` |
| Task | Only the creator writes | `taskWritableBy` in `src/features/tasks/api/task-visibility.ts` |
| Tool approval gate | Answered automatically only while the creator is still a member with the needed role | `src/features/session-runtime/api/creator-gate.ts` |
| Share link | One liveness rule and one scope predicate; the grant is checked again when the link is used; the share list never returns tokens | `src/lib/share-token.ts`, `src/features/files/api/live-share.ts` |
| Folder path write | Every existing segment must be writable by the caller; named agent output folders are open to every member | `refuseTeammateFoldersOnPath` in `src/features/files/lib/team-folder.ts`, `AGENT_OUTPUT_FOLDER_PATHS` in `src/features/files/lib/paths.ts` |
| Workspace-scoped write from a page | The client sends `expectedOrganizationId`; a mismatch returns `WORKSPACE_CHANGED` (409), the only code that reloads the client | `src/lib/assert-expected-organization.ts` |

Shared task readers cannot attach files, retry a run or open the creator's live browser. An approval recovered after the creator left the workspace is stored as a `FORBIDDEN` tool result.

#### Request context at RSC entry points

Every route handler, cron, webhook and `waitUntil` runs inside `withRequestContext`. The same applies to a server layout or server component that opens its own data path. Without it, `requireCtx()` throws downstream and logs lose `request_id` and `trace_id`.

Wrap the data work, not the JSX. `redirect()` throws `NEXT_REDIRECT`, which unwinds out of the context cleanly, so guards inside the wrapper still work. `src/app/app/(shell)/layout.tsx` is the example.

`just-a-wrapper/require-request-context` enforces this for `src/app/api/**/route.ts`: each exported method handler must call `withRequestContext` or `withApiRoute`. Server layouts are outside that rule's path filter, so they follow it by convention.

### Better Auth wiring

Sign-in is passwordless: an email code or Google. A code for an unknown email creates the account. Better Auth stores its tables in the app's Postgres database. See [Better Auth docs](https://www.better-auth.com/docs).

| File | Role |
|---|---|
| `src/lib/auth.ts` | The server instance: Drizzle adapter, `emailOTP` and `organization` plugins, `nextCookies` last, rate limits in the database |
| `src/app/api/auth/[...all]/route.ts` | Mounts every Better Auth endpoint through `withApiRoute` |
| `src/lib/auth-client.ts` | The browser client the sign-in forms call |

- The auth session table is `auth_session`, so it does not collide with the agent `session` table.
- `nextCookies()` is the last plugin so server actions persist cookies ([Better Auth Next.js integration](https://www.better-auth.com/docs/integrations/next)).
- A workspace is a Better Auth organization.
- Google is offered only when the `googleSignIn` capability is on ([03b](03b-configuration-map.md)).
- Auth email goes through the shared notification service and email layout.
- The purge cron deletes rate-limit counters untouched for a day (`src/features/auth/api/purge-rate-limits.ts`).

---

## 6. Env guard on operator + dev surfaces

| Surface | Flag | Gate |
|---|---|---|
| `(admin)` console | `NEXT_PUBLIC_ENABLE_ADMIN_ROUTES` | `requireAdminAccess` in `src/app/(admin)/admin-access.ts`, called by `src/app/(admin)/layout.tsx` and by every admin route handler. It returns 404 when the flag is off, and sends a signed-out visitor to sign in on any host except a loopback app (`adminConsoleAccess` in `src/lib/env-schema.ts`) |
| Dev routes (`/api/dev/login`) | `NEXT_PUBLIC_ENABLE_DEV_ROUTES` | Files are named `route.dev.ts`, which `next.config.ts` compiles only when the flag is on; each handler also requires `DEV_AUTH_ENABLED` and a localhost request (`src/lib/dev-auth.ts`) |

Route handlers bypass layouts, so each handler checks its own gate.

Both flags are refused in production by env validation: `adminDeploymentSchema` in `src/lib/env-schema.ts` fails startup when either is `true` on a production deployment. Loopback production builds and Vercel preview deployments may enable them.

---

## 7. Env validation

`src/lib/env.ts` is the one reader of configuration from `process.env`; the platform keys `just-a-wrapper/no-raw-env-read` allows are the only direct reads. It uses `@t3-oss/env-nextjs` with Zod ([t3-env docs](https://env.t3.gg/docs/nextjs)).

- Required setup keys live in `src/lib/env-schema.ts`, shared by runtime validation and `pnpm validate:config`.
- Optional service keys live in `env.ts`. Each optional provider becomes a capability once ([section 11](#11-custom-tool-handler-shape), [03b](03b-configuration-map.md)).
- Only `NEXT_PUBLIC_*` keys are listed in `experimental__runtimeEnv`; server keys are read from `process.env` directly.
- Server keys cannot reach client code; the `createEnv` types prevent it.
- `isEnvironmentKeySet` reports whether a key was provided, before defaults apply. The admin environment page receives only that boolean.
- `rejectedEnvironmentKeys` returns only key names, because validation errors can contain secret values.

---

## 8. Client state

There is no client state library. A store is a module in the feature's `lib/` read through `useSyncExternalStore`, with its hook in `hooks/` ([code standard 5.4](01-code-standard.md#5-react)).

| State | Lives in | Example |
|---|---|---|
| Server data read by client components | React Query in the feature's `api/` | Sidebar recents, command search, memory notes |
| A page read only the server needs | Async server component under `<Boundary>` | Settings pages |
| Live stream frames | A reducer store fed by the event stream | `src/features/chat/lib/chat-store.ts`, `src/features/realtime/lib/stream-store.ts` |
| Shared ephemeral UI within or across features | A `useSyncExternalStore` store in the owning feature's `lib/` | `src/features/chat/lib/composer-banner-store.ts` |
| A client lifecycle | A pure reducer in `lib/` ([code standard 10](01-code-standard.md#10-state-machines)), mounted with `useReducer`, or with `useMachineStore` when code needs the state synchronously or whether a dispatch moved it | `src/features/chat/lib/connection-machine.ts` |
| URL query state | `nuqs` parsers in the feature's `lib/`, shared by client hooks and server reads | `src/features/files/lib/library-search-params.ts` |
| Composer drafts | One keyed store over a pure reducer; a task's text also in `localStorage`, parsed with Zod ([decision 0041](../decisions/0041-one-composer-draft.md)) | `src/features/chat/lib/draft-store.ts` |
| Tool decisions in a task | One owner hook for relayed gates and held custom calls, read by each tool line through context ([decision 0042](../decisions/0042-one-owner-for-tool-decisions.md)) | `src/features/chat/hooks/use-tool-decisions.ts`, `ToolDecisionsContext` |
| One request in flight from a button or form | `useAsyncAction` (`run` for one awaited call, `begin` and `finish` for hand-held flows) | `src/hooks/use-async-action.ts` |
| Component-local state | `useState` | A menu's open flag |

A reducer store lives as long as its component. State that belongs to one session sits under a component keyed by that session; `ChatView` keys itself.

A store lives in the feature that owns the concern. Other features import it along a listed edge. There is no global stores folder.

---

## 9. API client wrapping

Each external SDK has one server-only client, created on first use through `lazyValue` (`src/lib/lazy-value.ts`). Examples: `getAnthropicClient` in `src/features/agents/api/anthropic-client.ts` and `getStripe` in `src/lib/stripe.ts`. A client whose capability is off returns null, and a `require*` function turns that into a typed error.

Browser code never calls a third-party SDK. It calls the app's `/api` routes, and secrets stay on the server.

### Billing payment rules

- Credits convert from vendor cost in one function, `creditsForVendorCents` in `src/features/billing/lib/credit-math.ts`. See [decision 0016](../decisions/0016-one-credit-one-margin.md).
- A manual top-up is any whole number of credits from `STARTER_PACK_CREDITS` (500) upward, priced exactly. `isTopupCredits` in `src/features/billing/pricing-config.ts` is the rule. The ceiling is `STRIPE_MAX_CHARGE_CENTS`, the largest charge Stripe takes on every payment path ([Stripe charge limits](https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts)).
- Manual top-ups charge off-session with the subscription's default payment method, or the customer's invoice default when it has none. A missing method opens Checkout. A decline or an authentication demand charges nothing and offers the customer portal. A processing payment waits for its webhook.
- Each manual purchase carries an attempt key that the client keeps across retries. The server records it in `manual_topup_attempt` on the database clock; past Stripe's idempotency window a retry looks the payment up instead of charging again. The `credit_grant` unique index on `(workspace_id, source_ref)` is the only de-duplication of grants: PaymentIntent IDs for top-ups, invoice IDs for plan grants ([decision 0032](../decisions/0032-one-ledger-clock-and-explicit-payment-records.md)). See [decision 0019](../decisions/0019-grant-top-ups-on-the-database-clock.md).
- A plan change that charges now shows Stripe's previewed amount first, and the server previews again with the same proration date and refuses if the amount moved. The update uses `payment_behavior: error_if_incomplete`, so a declined card leaves the plan as it was. Plan changes never grant credits themselves: the paid invoice does ([decision 0047](../decisions/0047-subscriptions-with-a-fenced-credits-only-mode.md)).
- Usage recording inserts the event, updates counters and debits credits in one transaction.
- Stripe handlers use the SDK's event-specific payload types. Test doubles sit at the SDK boundary.
- Locally, Stripe cannot reach localhost, so a purchase needs `pnpm stripe:listen` running beside the app ([operations](../operations.md)). Checkout return reconciliation is a fallback, not a replacement for the webhook.

---

## 10. Notifications and email

`notify()` (`src/features/notifications/api/notify.ts`) stores one row per recipient and publishes a recipient-only event. A schedule set to email sends it whether or not the person is away; every other email needs the category's Email switch on and the person away. Each recipient is delivered independently, and `email_status` moves through `notificationEmailMachine`, so a retry sends only the unsent email. The retry sweep checks the switch, membership and account again before sending, and an email still unsent after a day ends `expired` ([decision 0039](../decisions/0039-notification-switches-come-from-events.md)).

Email is a capability: Resend when `RESEND_API_KEY` is set, console output in development, off otherwise. When email is off, email-code sign-in is unavailable and invitations return copyable links. Every template uses the shared email layout.

---

## 11. Custom tool handler shape

**One tool-name union.** `TOOL_DECLARATIONS` in `src/features/tool-catalog/declarations.ts` lists every custom tool, and `CustomToolName` is derived from it. `KnownToolName` in `src/features/chat/lib/tool-names.ts` adds built-in, memory and Composio names. Every catalog keyed by tool name uses that union, so a new tool fails the type check until each catalog has its entry.

| Concern | File |
|---|---|
| Contracts (declaration, handler, dispatch types) | `src/features/tool-catalog/types.ts` |
| Declarations: name, description, risk, input JSON schema and capability gate | One file per tool or family in `src/features/tool-catalog/`, listed in `declarations.ts` |
| Handlers, loaded lazily, one entry per `CustomToolName` | `src/features/tools/custom-tool-registry.ts` |
| Input parse and output validation behind one interface | `src/features/tools/lib/bind-tool.ts` |
| Policy checks, execution and the persisted result | `src/features/tools/api/dispatch-execution.ts` |
| Delivery upstream, usage accrual and retry | `src/features/tools/api/tool-delivery.ts` |
| Chat display catalog | `src/features/chat/lib/tool-activity-catalog.ts` |

**Capabilities.** `src/lib/capabilities.ts` resolves web search, browsing, media and the other providers once. A declaration's `gate` names the capability that turns the tool on; a tool with no gate is always on. `isToolAvailable` reads the gates, and the seed plan, the handler registry and the permissions shelf all call it. See [decision 0009](../decisions/0009-capabilities-resolved-once.md).

**Rules**:
- A handler calls the owning feature's API and returns schema-validated output. Invalid input never reaches it.
- A destructive custom tool uses the persisted confirmation queue. Anthropic's built-in and MCP confirmation policy does not cover custom tools.
- A media handler saves output to Vercel Blob before returning a URL, so agents never hold a vendor URL that expires.
- A billing failure keeps the persisted result for retry; it never reruns the handler or replaces its result.
- Add a tool: add its declaration (with its `gate` if a capability offers it), its handler, its registry entry and its renderer. The type check lists every catalog that still needs it.
- Remove a tool: delete its declaration, handler and registry entry.

---

## 12. Naming rules

[Code standard 7](01-code-standard.md#7-naming-and-comments) holds the general naming rules. These add folder and file rules.

- **Folder names are nouns naming a domain:** `chat`, `files`, `tools`. No abbreviations: `notifications`, not `notifs`.
- **Banned folder names:** `utils`, `helpers`, `common`, `shared`, `services`, `manager`, `handlers`, `processors`, `controllers`. Name what the code does.
- **Banned suffixes:** `Manager`, `Handler`, `Processor`, `Controller`, and `Service` as a class suffix.
- **A custom tool file is named for its tool** (`fetch-page.ts`). A file that holds one family of tools is named for the family (`library-verbs.ts`, `schedules.ts`).
- **Schema files group tables by domain** in `src/db/schema/`; a small table that only serves another lives in that table's file.

**Routes do nothing.** A route parses input, calls a feature function and returns through `withApiRoute` (`src/lib/route-kit.ts`). `withApiRoute` owns request context, failure logs, error capture and the post-response flush. Route error messages come from fixed copy keyed by code (`src/lib/route-error-messages.ts`). `fetchJson` (`src/lib/fetch-json.ts`) returns `unknown`; the caller parses a successful response with its schema before reading fields.

---

## 13. Instrumentation: app-init in one place

`src/instrumentation.ts` is the Next.js file that runs once per server instance ([Next.js instrumentation](https://nextjs.org/docs/app/guides/instrumentation)). It wires the PostHog error client, the OpenTelemetry log exporter and the process-level error handlers, and `onRequestError` captures errors that escape the framework. Every "wire this up at boot" concern goes there and nowhere else. Feature logic does not. See [04-observability.md](04-observability.md).

---

## 14. React component patterns

### Forms: the one way to build one

Every place a person edits and commits a value is a `Form` from `@/components/ui/form`. It renders a real `<form>`, takes every normal form prop, and adds Cmd+Enter (Ctrl+Enter on Windows and Linux) from any field inside it. `src/components/settings/settings-detail-row.tsx` and the modals in [09-modals.md](09-modals.md) show the shape. See [decision 0011](../decisions/0011-one-form-primitive.md).

- **Save is `type="submit"`, and it carries the rules.** The shortcut presses the form's default button, so `disabled` means unchanged, invalid and pending for the mouse and the keyboard alike. Every other button in the form is `type="button"`.
- **A Save that sits outside the form** uses `form={id}` with the `Form`'s `id` (`SettingsDetailRow`, the memory editor).
- **A form with no visible button** (inline rename) sets `className="contents"` so it adds no layout box. Its `onSubmit` is the commit.
- **Plain Enter is browser behaviour.** It submits from a single-line input and adds a newline in a textarea. Held keys, IME composition and Shift or Alt chords never submit.
- **A handler that owns a key calls `preventDefault`,** and the `Form` leaves that key alone. The chat composer sends this way.
- **A field that commits on blur** flushes its draft with `flushSync` on Cmd+Enter so the submit reads the new value (`src/features/scheduled/components/schedule-time-select.tsx`).

`just-a-wrapper/require-form-primitive` fails on a raw `<form>`, a hand-written Cmd+Enter, `field.form.requestSubmit()`, an Enter key handler on a text field, and a modal with a text field and no `Form`. Suppress it with a reason only when the key does not submit anything, such as applying a typed colour to a picker. Confirm dialogs that edit nothing are not forms.

### Components

- **Server components by default.** `'use client'` marks the smallest leaf that needs state, effects, browser APIs or event handlers. Its parents stay server components.
- **Composition over boolean props.** When a component grows flags such as `isExpanded`, `hasIcon` or `variant`, split it into compound components or take children.
- **No fetch in an effect.** Page reads are server components under a `<Boundary>`; client reads are React Query, which owns cancellation and caching.
- **No effect for derived state.** Compute it during render ([code standard 5.1](01-code-standard.md#5-react)).
- **Refs hold browser handles, timers and attempt tokens,** not state.
- **Memoize for a measured reason** ([code standard 5.7](01-code-standard.md#5-react)). The React Compiler is not enabled.
- **Pair Suspense with an error boundary through `<Boundary>`** (`src/components/layouts/boundary.tsx`). A component inside it renders data its server parent already awaited, so it takes non-null props and adds no optional checks. Raw `<Suspense>` appears only around the lazy chart imports in `src/app/_overlays/overlay-registry.tsx` and `src/features/chat/components/tool-renderers/chart-preview-loader.tsx`. See [11-rendering-and-resilience.md](11-rendering-and-resilience.md).
- **Four states.** A data view is done when it renders loading (a skeleton shaped like the content), empty, success and error ([code standard 5.5](01-code-standard.md#5-react)).
- **Accessibility is part of the feature.** Icon-only buttons have an `aria-label`. Tab, Escape and Enter work. Modals trap and restore focus. Animations honour `prefers-reduced-motion`. Touch targets are at least 44px.

### Workspace switching

- `HomeView` is keyed by organization (`src/app/app/(shell)/page.tsx`), so a switch remounts it and discards the live draft and any creation in flight.
- Home tells a missing workspace apart from a failed read. A missing or deleted workspace keeps navigation available so the member can pick another.
- Text over `LONG_TEXT_ATTACHMENT_CHARS` (10,000) characters is sent as an attached file (`src/features/chat/lib/message-limit.ts`). File and skill references do not count against the text.

---

## 15. Project skills

`.claude/skills/` holds the playbooks for people who adopt this repo. Read `.claude/skills/<name>/SKILL.md` when the task matches.

| Skill | Use it for |
|---|---|
| `make-it-yours` | Turning the app into your own product from one sentence |
| `customize-brand`, `customize-theme`, `customize-pricing`, `customize-skills-pack` | Rebranding and configuring a fork |
| `run-locally` | Installing, configuring and starting the app locally |

## 16. Linting + formatting

ESLint runs the lint rules, including this repo's own rules. Biome formats and sorts imports. The custom rules need ESLint's plugin API, which Biome does not offer. See [decision 0010](../decisions/0010-custom-eslint-rules-keep-standards.md).

The custom rules live in `eslint-rules/` and are registered in `eslint-rules/index.mjs` under the `just-a-wrapper/` prefix. `eslint.config.mjs` sets where each applies.

| Rule | Enforces |
|---|---|
| `no-bare-error-throw` | Every throw in `src/` is an `AppError` subclass |
| `no-silent-catch` | A catch never swallows an error ([04-observability.md](04-observability.md)) |
| `no-stray-console` | Product code logs through the structured logger |
| `no-journal-comments` | Comments state the present, with no dates or ticket numbers |
| `suppression-requires-reason` | Every lint suppression explains itself |
| `no-raw-color-literals` | Colors come from design tokens ([08-design-system.md](08-design-system.md)) |
| `require-form-primitive` | Every committed value goes through `Form` ([section 14](#forms-the-one-way-to-build-one)) |
| `require-request-context` | Every API route handler opens request context |
| `require-action-boundary` | Every server action calls `runAction` or `withRequestContext` |
| `no-direct-session-read` | Only the caller resolvers read the auth session ([section 5](#5-route-groups--auth-guard)) |
| `no-machine-status-write` | Each lifecycle column has one writer, listed in `eslint-rules/no-machine-status-write.mjs`, covering status, lease, trash, share and archive columns; `tests/eslint-rules/machine-owners.test.mjs` fails when a state machine has no owner |
| `no-deep-feature-import` | API routes import a feature only through `index.ts` or `server.ts` |
| `no-shared-feature-import` | `src/lib`, `src/hooks`, `src/components` and `src/db` never import a feature |
| `no-upward-feature-import` | A feature imports only lower layers, or features listed before it in its own layer, of `eslint-rules/feature-layers.mjs` |
| `import-style` | `@/` for imports that leave a feature or top-level `src` folder, and no `.ts` suffix ([code standard 6.7](01-code-standard.md#6-files-and-modules)) |
| `no-effect-fetch` | An effect never fetches; server data goes through React Query ([decision 0044](../decisions/0044-one-way-to-load-and-change-server-data.md)) |
| `no-raw-intl-format` | Values a person reads are formatted by `src/lib/format/` ([decision 0043](../decisions/0043-one-way-to-format-values.md)) |
| `no-raw-env-read` | Configuration is read through `src/lib/env.ts` |

`no-deep-feature-import`, `no-shared-feature-import` and `no-upward-feature-import` are the feature boundaries in [code standard 6.2](01-code-standard.md#6-files-and-modules) and [decision 0027](../decisions/0027-enforced-feature-boundaries.md). `eslint.config.mjs` also bans `lucide-react` imports, raw `fetch('/api/...')` calls and raw `posthog.capture`, and turns on the type-aware rules listed in [code standard 9](01-code-standard.md#9-enforcement).

**Quality gates.**

- `pnpm verify` runs format check, lint, the dead-code check (`pnpm deadcode`: Knip over unused files, exports and dependencies), typecheck, unit tests, schema drift and build. Run it before opening a pull request.
- CI (`.github/workflows/ci.yml`) runs `pnpm verify`, the database integration tests and the Playwright smoke tests.

TypeScript runs with `strict: true`.

---

## 17. GitHub workflow

Use focused branches and pull requests. Run `pnpm verify` before requesting review, and describe what changed, why, and how it was checked. Commit subjects use imperative verbs. Never commit credentials or local artifacts. See [CONTRIBUTING.md](../../CONTRIBUTING.md).

Apply required migrations before releasing code that depends on them; follow [the deployment guide](../deploy.md). Revert a faulty change with a new commit rather than rewriting shared history.

---

## 18. Workspace lifecycle and security rules

| Rule | Enforced in |
|---|---|
| Workspace deletion releases browser sessions and every saved member browser context, in the post-response worker and the purge cron. A cleanup failure keeps the context identity for retry and does not block deletion. | `src/features/workspaces/api/cleanup-deleted-workspace-browsers.ts` |
| Pending invitations are unique per email, ignoring case. | `invitation_pending_email_uq` in `src/db/schema/auth.ts` |
| Vault provisioning and health compare the stored signing-key fingerprint with the configured secret, so rotating the secret renews member credentials. | `src/features/integrations/api/provision-vault.ts`, `vault-health.ts` |
| Markdown images load automatically only from the app's own file and artifact content routes. Other sources render as links, and invalid protocols as plain text. Private file routes authorize before redirecting to a signed Blob URL. | `src/lib/markdown-image-source.ts`; the `img-src` policy in `src/lib/image-csp.ts`, set by `src/proxy.ts` |
| The configured Blob token is validated at startup; other Blob stores are not trusted. | `src/lib/image-csp.ts` |
