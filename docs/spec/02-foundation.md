# Foundation: architecture

This doc covers the machinery under the product: the Anthropic primitives, the MCP proxy, memory, tools, files, notifications, live state, billing, environments, the main request flows, access rules and recovery. Pages and flows are the shipped code (see [00-start-here.md](00-start-here.md)). Code conventions live in [01-code-standard.md](01-code-standard.md) and [03-patterns.md](03-patterns.md). Error discipline lives in [04-observability.md](04-observability.md).

The shape in one sentence: thin routes call `src/features/`, and `src/features/` calls external services we never rebuild (§8).

---

## 1. Stay on Anthropic's grain

We use the Managed Agents primitives as they are and add no parallel layer over them ([decision 0001](../decisions/0001-build-on-managed-agents.md)). Provider documentation: [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview).

### 1.1 Primitives at a glance

| Primitive | What we use it for | Constraint the app depends on |
|---|---|---|
| Agent | One platform-wide record per intelligence tier (§1.3), shared by every workspace. | An agent is versioned. A scheduled deployment pins a version. |
| Environment | One per deploy environment (§11). | Networking is set at creation. `src/features/agent-setup/seed-plan.ts` chooses `limited` only when Browserbase is configured and native web search is off; otherwise `unrestricted`, because native web tools and sandbox browsing reach hosts unknown at seed time. |
| Session | Every chat and every task run. | Created with a `budget` from the workspace balance. A budget can only be attached at creation ([sessions](https://platform.claude.com/docs/en/managed-agents/sessions), [budgets](https://platform.claude.com/docs/en/managed-agents/budgets)). |
| Event | Relayed to the browser over our SSE route (§12.9). | Event types and stop reasons: [reference](https://platform.claude.com/docs/en/managed-agents/reference#event-types). |
| Memory store | A workspace store and a user store per member (§2). | At most 8 stores per session; attachment `instructions` up to 4,096 characters; `access` is enforced at the filesystem level ([memory](https://platform.claude.com/docs/en/managed-agents/memory)). |
| Skill | Anthropic presets, the starter pack and user-authored skills. | [Skills](https://platform.claude.com/docs/en/managed-agents/skills). |
| Vault | One per member, holding the JWT the MCP proxy verifies (§1.4). | Vault credentials authenticate MCP calls with `Authorization: Bearer` ([vaults](https://platform.claude.com/docs/en/managed-agents/vaults)). |
| File | Mid-session attachments and agent output capture into Vercel Blob (§4). | Mounts are capped at 25 MiB by `MAX_SESSION_MOUNT_BYTES` in `src/features/files/lib/limits.ts`. |
| Scheduled deployment | One deployment per cron task (§12.5, [decision 0005](../decisions/0005-anthropic-owns-scheduled-runs.md)). | [Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments). |

### 1.2 Where per-workspace variation lives

The agent record holds model, system prompt, tools, MCP servers, skills and the multiagent roster. Each session carries the per-workspace and per-member parts: `vault_ids`, `resources` (memory stores and files), `metadata` and `budget`.

The provider also accepts per-session agent overrides (`agent_with_overrides`, [sessions](https://platform.claude.com/docs/en/managed-agents/sessions#override-agent-configuration-for-a-session)). The app does not use them. Per-member customization goes through memory (§2).

A `system.message` event is accepted only on [supported models](https://platform.claude.com/docs/en/managed-agents/events-and-streaming#supported-models). `tierSupportsSystemMessages` in `src/features/agents/config.ts` records which tiers accept it.

### 1.3 Agent records are intelligence tiers

The user picks one of three tiers. The app shows tier names, never model names (`TIER_DISPLAY` in `src/features/agents/config.ts`).

| Tier slug | User-facing name | Agent ID variable |
|---|---|---|
| `fast` | Fast | `ANTHROPIC_AGENT_ID_FAST` |
| `default` | Balanced | `ANTHROPIC_AGENT_ID_DEFAULT` |
| `pro` | Expert | `ANTHROPIC_AGENT_ID_PRO` |

- Models per tier live in `AGENT_TIERS` in `src/features/agents/config.ts`. Credit multipliers and per-token rates live in `TIER_CREDIT_MULTIPLIER` and `MODEL_PRICING_CENTS` in `src/features/billing/lib/credit-math.ts`.
- A tier is our concept: a slug on session and task rows that maps to an agent ID variable. There is no agent table.
- Every tier's record is a coordinator with a `self` roster entry, so it can hand self-contained work to a copy of itself in a separate thread (`selfCoordinator` in `seed-plan.ts`).

### 1.4 The MCP proxy

Composio binds a tenant at URL-mint time, and its only auth header is the organization-wide `x-api-key`. Vault credentials inject only `Authorization: Bearer`. So one shared agent record cannot call Composio directly. The agent's only MCP server is our proxy at `/api/mcp/composio` ([decision 0002](../decisions/0002-shared-agents-and-composio-proxy.md)).

```
Agent container
  └─ vault Bearer: a JWT we signed for the member
     → /api/mcp/composio verifies it and reads member_id (the member's composio_user_id)
       → resolves the member's Tool Router URL
         → forwards JSON-RPC with x-api-key; the response streams back unchanged
```

- The JWT payload is `{ member_id, exp }`, signed with `MCP_PROXY_JWT_SECRET` (`src/features/integrations/jwt.ts`). The proxy never forwards the inbound Bearer.
- `ensureMemberVault` in `src/features/integrations/api/provision-vault.ts` creates one vault per member and renews its credential. Rotating the secret invalidates every token.
- Tool Router loads toolkit tools on demand, so the agent never enumerates a whole catalog ([decision 0022](../decisions/0022-composio-with-one-shared-account-per-app.md)).
- Request flow: `src/features/integrations/api/forward-mcp-request.ts`.

### 1.5 What we do not invent

- Plugins. There is no such primitive. Starter packs are deploy-time content.
- Workflow engines. A workflow is a scheduled or event-triggered task: instructions, a trigger and a permission mode.
- Interception of arbitrary MCP actions. Only calls the provider gates with `ask` reach our permission resolver (§3).
- Slash commands. Users type prompts.
- Team agents or vertical configuration tables. A new niche is a fork (§10).

If a term needs a paragraph of definition and is not in §1.1, the answer is no.

---

## 2. Memory architecture

Memory uses provider memory stores directly. Our database stores only the mappings: `workspace.workspace_memory_store_id` and `workspace_member.user_memory_store_id`. Content lives with the provider.

| Store | Created by | Mount | Access |
|---|---|---|---|
| Workspace store | Workspace provisioning, one per organization | `/mnt/memory/workspace/` | `read_write` for owners and admins, `read_only` for members |
| User store | Member provisioning, one per user per organization | `/mnt/memory/user/` | `read_write` |

- `resolveSessionMemoryResources` in `src/features/memory/api/session-resources.ts` builds the attachments. A missing role row resolves to `read_only`. The provider enforces access, so a member's prompt-injected session cannot write workspace memory.
- Mount paths come from store names. `src/features/memory/lib/memory.ts` keeps the names aligned with the mounts.
- The agent decides which store to write, guided by the attachment instructions (`USER_STORE_INSTRUCTIONS` and `WORKSPACE_STORE_INSTRUCTIONS` in `memory.ts`). The user store is authoritative for tone and personal preferences.
- There is no custom-instructions setting. Personal customization is memory, which keeps agent records shared (§1.4).
- Store provisioning and adoption: `src/features/memory/api/provision-stores.ts`.
- Automatic note naming is local and derives the filename from content (`apply-derived-note-title.ts`). A naming failure keeps the saved content.

---

## 3. Tooling layer

Tools come in three kinds:

- **Native**: the provider's bash and file tools, `web_search`, `web_fetch` and memory tools.
- **MCP**: Composio Tool Router through the proxy (§1.4).
- **Custom**: our app actions and media tools, declared in `TOOL_DECLARATIONS` in `src/features/tool-catalog/declarations.ts`. Handler shape: [03 §11](03-patterns.md#11-custom-tool-handler-shape). Dispatcher: [04 §11.1](04-observability.md#111-custom-tool-dispatcher).

Tool names form one union derived from `TOOL_DECLARATIONS`. The chat catalogs are keyed by `KnownToolName`, which extends that union.

### Optional providers

Optional providers resolve once ([decision 0009](../decisions/0009-capabilities-resolved-once.md)). `resolveCapabilitiesFromEnv` in `src/lib/capabilities.ts` is the one place environment values become `Capabilities`. The runtime (`src/lib/runtime-capabilities.ts`), the seed script (`scripts/seed-agents.ts`) and the drift check (`src/features/agent-setup/api/prompt-drift.ts`) all call it.

Each custom tool's declaration names the capability that offers it (`gate`, from `src/features/tool-catalog/gates.ts`); the two built-in web tools have their gates in `declarations.ts`. `isToolAvailable` reads those gates and filters seed declarations, the dispatch registry and the permissions shelf through them.

| Capability | Configured | Not configured |
|---|---|---|
| Web search (`EXA_API_KEY`) | `web_search_exa` and `fetch_page`; native web tools off | Native `web_search` and `web_fetch` |
| Browser (both Browserbase keys) | `browse_open`, `browse_page`, `browse_act`, `browse_close` | Playwright and Chromium preinstalled in the sandbox |
| Media (`AI_GATEWAY_API_KEY`) | `generate_image`, `edit_image`, `generate_video`, `generate_audio`, `transcribe_audio` | Tools not declared; voice controls stay visible and show the off message |

Re-seed agents after a configuration change. The admin Environment page flags drift in prompts, tools and networking. See [decision 0023](../decisions/0023-exa-finds-browserbase-reads.md).

Media handlers choose the vendor model inside the handler, never in the tool contract. Output is saved to the Library before the tool result is delivered, so the agent never holds a vendor URL.

### Permission enforcement

Safe built-ins run, sensitive built-ins ask, and a member can set any tool to allow, ask or block on the Tools page ([decision 0021](../decisions/0021-every-tool-visible-with-real-controls.md)). Interactive sessions use the `ask` baseline. Scheduled runs use `auto` when `task.auto_approve` is on.

- Only a session's creator answers its gates. Answering requires the write grant from `authorizeSessionWrite` in `src/features/sessions/api/session-access.ts` (§13).
- A pending gate offers allow once, allow for this session (stored in `session_tool_approval`), allow always (the creator's Tools setting) or deny. A global Block overrides a session approval.
- Session approval is exact-tool state. A Tool Router batch records each embedded action name, so a later call with an unapproved action still gates.
- Automatic answers act as the creator, whoever's relay or sweep sees the gate. `creatorGateResolver` in `src/features/session-runtime/api/creator-gate.ts` answers nothing while the creator has left or lost the role a read-write memory task needs; the gate stays open.
- `user.tool_confirmation` covers agent and MCP tool calls only ([reference](https://platform.claude.com/docs/en/managed-agents/reference#event-types)). Custom-tool gating is our dispatcher's job: a destructive call in an interactive session persists a `pending_confirmation` row and waits for `/api/custom-tools/confirm`.

---

## 4. File system

The Library stores bytes in one private Vercel Blob store. Postgres owns names, folders, visibility and soft deletion. Storage keys start with `ws/{workspaceId}/` (`src/features/files/lib/paths.ts`).

- **Uploads**: the browser uploads directly to Blob with a token from `/api/files/upload-token`, then calls `/api/files/sync-metadata`. Both check the caller and the plan's file size limit (`planLimits` in `src/features/billing/api/plan-limits.ts`; the sizes live in `PLANS` in `src/features/billing/pricing-config.ts`). Size and type come from Blob, not the browser.
- **Agent output**: `importDriveFile` writes generated files and saved artifacts without the plan limit, so a paid result is never rejected after generation.
- **Reads**: `/api/files/[id]/content` and `/thumbnail` check membership and visibility, or a live share token, then redirect to a five-minute signed URL.
- **Thumbnails**: images up to 50 MiB get a 512px-wide WebP at `ws/{workspaceId}/.thumbs/{fileId}.webp`. Other files have none.
- **Profile images**: avatars and workspace icons live under `avatars/` and `workspace-icons/`, never as Library rows, with a 5 MiB limit (`PROFILE_IMAGE_LIMIT`).
- **Folders**: rename, move and soft delete change only Postgres.

---

## 5. Notifications

The bell reads the `notification` table through an authenticated feed API, scoped to workspace and recipient. In-app preferences filter before pagination. `notify()` records each occurrence with an idempotency key and publishes a recipient-only realtime event.

Email goes straight through Resend ([decision 0024](../decisions/0024-postgres-and-sse-for-live-state.md)). Only requested or urgent events send email. A schedule's own email choice sends at once; other email follows the category's Email switch and waits until the person is away. Settings → Notifications shows a switch only for a channel some event delivers on. Every email renders through `email-layout.ts`. The email capability has three states: Resend, console (development without a key prints the email, including sign-in codes, to the server log) and off (email-code sign-in is hidden and invitations offer a link to copy).

---

## 6. Real-time state

The task SSE carries the open conversation. One shared `EventSource` per browser tab reads `/api/realtime/stream` for sidebar state, credits and notifications.

- `publishWorkspaceEvent` and `publishSessionEvent` insert into `realtime_event`. The stream polls, scoped to the organization and to either the workspace audience or the recipient.
- Private session content reaches only its creator.
- Membership is checked on every poll. `Last-Event-ID` replays recent rows; an older cursor restarts at the latest row and the client refetches.
- The stream closes below the function's duration limit and the browser reconnects. The purge cron deletes old rows.
- Timings live in `src/features/realtime/constants.ts`.

---

## 7. Billing architecture

A deployment with Stripe sells monthly plans (`subscriptions`, the default) or credits only (`credits_only`), one billing mode resolved by `billingCapability()` in `src/lib/runtime-capabilities.ts` from the `BILLING_MODE` env var and the admin console's stored setting ([decision 0047](../decisions/0047-subscriptions-with-a-fenced-credits-only-mode.md)). Code reads the mode's rules (`billing-mode-rules.ts`), never its name. A credit is one cent of provider cost plus one margin setting ([decision 0016](../decisions/0016-one-credit-one-margin.md)). Usage is metered from the provider's actual cost ([decision 0015](../decisions/0015-meter-from-actual-provider-cost.md)).

- **One conversion.** `creditsForVendorCents` in `src/features/billing/lib/credit-math.ts` turns vendor cents into credits for every metered path.
- **Round once per session.** A session keeps its exact customer-billable vendor cost in `session.vendor_cost_cents`. Each usage event adds its exact cost and charges what the total now owes beyond `session.credits_consumed`, so a row can charge 0 credits for a positive cost ([decision 0031](../decisions/0031-round-once-per-session.md)). Usage with no session (dictation) rounds once per event. Platform-paid usage records its cost and charges nothing.
- **The ledger owns the balance.** Active grants minus consumption form one workspace pool (`src/features/billing/api/credit-ledger.ts`). New spending settles outstanding debt first. Debt rows carry a `debt_kind` (`usage`, `hold`, `refund`, `restored`) and a `parent_grant_id`; `source_ref` is only the idempotency key ([decision 0032](../decisions/0032-one-ledger-clock-and-explicit-payment-records.md)).
- **The ledger has one clock.** `lockLedger` reads the database's `now()` into `ledger.now`, and every grant, debt and balance read decides time with it. A spendable grant takes `issuedAt: 'now'`; only a future plan bucket takes a date.
- **Session spend is capped by the provider.** With billing on, every session and deployment carries a `budget` derived from the balance (`sessionBudgetForCreditBalance` in `src/features/billing/lib/session-budget-value.ts`). A task run's budget is capped at the smaller of the balance and its creator's remaining member allowance (`spendableCredits` in `spend-gate.ts`), when it is created, adopted or raised. The provider stops the session with `budget_reached` when it reaches the cap. After a grant, `src/features/billing/api/sync-session-budgets.ts` raises budgets on live sessions and deployment templates; a task run whose creator has no allowance left keeps its budget.
- **A charge locks the session row, then the workspace row.** `recordUsage` (`src/features/billing/api/record-usage.ts`) runs one transaction per usage event and first locks the session row to read its totals. `applyCreditCharge` (`apply-credit-charge.ts`) first reads the member's limit without the workspace lock, then `consumeWorkspaceCredits` locks the workspace row and moves the balance. The member limit is therefore a soft limit. A new workspace-wide check that must be exact has to take the workspace lock itself. Every write to `credit_grant` goes through `credit-grant-transitions.ts` and needs a `LockedLedger` from `ledger-lock.ts`.
- **A refusal has two halves.** The server throws `CREDITS_EXHAUSTED`, `PLAN_LIMIT_REACHED` or `SKILL_LIMIT_EXCEEDED` with authored copy. `USER_COPY_CODES` in `src/lib/route-error-messages.ts` is the one list of codes whose message reaches the user as written; `routeErrorResponse` and `sessionRouteErrorResponse` both read it. In the chat client, `classifySendFailure` in `src/features/chat/lib/classify-send-failure.ts` is the one place that turns a failed send or create into a kind (`credits-exhausted`, `plan-limit`, `awaiting-tool-result`, `attachments-failed`, `upstream`, `other`), and `use-chat-send.ts` and `use-home-send.ts` switch on it exhaustively, each with its own copy and action. A new refusal reason adds its `ErrorCode` and status, joins `USER_COPY_CODES` if its message is user copy, and adds a kind to `SendFailure`; the compiler then stops at every composer switch until each one handles it, so no one is offered a top-up that cannot help. Other surfaces still read these codes directly: the tool and task credit pauses, the memory and skill actions, file uploads and schedules.
- **Usage is idempotent.** A partial unique index on `usage_event.usage_key` stops duplicate charges. The key is the provider event id or a `tool:`, `tts:`, `voice:`, `title:` or `runtime:` key. A charge that committed but did not finish its side effects stays `pending` until the replay or the billing sweep completes it.
- **Exhaustion pauses.** When a charge drops the balance to zero, or a member passes their limit, `pauseSessionOnExhaustion` in `src/features/billing/api/pause-session-on-exhaustion.ts` posts `user.interrupt` and sets `paused_no_credits`. The durable pause holds even if the interrupt fails.
- **Top-ups resume recent pauses.** A grant resumes sessions paused within `AUTO_RESUME_CUTOFF_MS` (`sync-session-budgets.ts`). Older pauses resume only through Resume, which requires a positive balance. Returning from Checkout calls `/api/billing/reconcile`, which applies the same grant if the webhook is late. The grant's source reference is the only de-duplication, so the webhook and the return page grant once. Grants use the database clock ([decision 0019](../decisions/0019-grant-top-ups-on-the-database-clock.md)).
- **Top-up attempts live on the server.** A manual purchase records its attempt key in `manual_topup_attempt`, stamped by the database clock; past Stripe's idempotency window a retry looks the payment up instead of charging. Usage settlement calls `maybeAutoTopup`, which starts at most one automatic payment and never throws; the `payment_intent` webhook and the billing cron finish it. A paid top-up or invoice whose customer maps to no workspace is refunded and reported.
- **Plans.** In subscription mode the plan dialog (`#plans`) sells a plan, interval and monthly package from Stripe's seeded prices (`list-plan-prices.ts`). A first plan uses Checkout in subscription mode (`create-plan-checkout-session.ts`). A change that starts now (a bigger plan or package, or monthly to yearly) charges Stripe's previewed proration, confirmed by the person, with `error_if_incomplete`; a smaller change is a schedule phase at renewal (`change-plan.ts`). Cancel and resume flip `cancel_at_period_end` (`cancel-plan.ts`). The paid invoice records the plan and grants its credits (`handle-invoice-paid.ts`); `customer.subscription.deleted` ends the plan and retires its credits. A workspace without a plan has `NO_PLAN_LIMITS` and can buy credits once. The Stripe portal keeps plan switching off.
- **Credits-only mode** (`src/features/billing/credits-only/`): no plan for sale, the top plan's limits for a workspace without one, refusals that offer nothing. Existing subscribers keep a read-only plan row, renewal grants, auto top-up and the portal.
- **Refunds and disputes** reconcile the current Stripe state (`handle-charge-reversal.ts`). A refund retires unconsumed purchased credits and records consumed ones as debt. A won dispute restores only what was removed. An inquiry claws back nothing.
- **Workspace limit.** A person can own at most five workspaces; `create-organization.ts` checks the count under a row lock.
- **Pin the Stripe API version** on the client.

### 7.1 Paid entry points

Every path that spends provider money, where the spend is checked and where the cost is recorded. One gate answers "may this person spend this estimate in this workspace now?": `checkSpend` and `assertCanSpend` in `src/features/billing/api/spend-gate.ts` ([decision 0037](../decisions/0037-one-spend-gate.md)). It refuses with `CREDITS_EXHAUSTED` when the balance or the person's remaining member allowance is below `max(estimate, MIN_TURN_CREDITS)`, reads both on the database clock, reserves nothing and allows everything when billing is off. Each gated entry point names itself (`GatedEntryPoint` in `src/features/billing/lib/paid-entry-points.ts`); `tests/integration/spend-gate.test.ts` fails when a vendor-backed tool has no estimate.

Session metering records model spans (`accrue-model-request.ts`), cumulative list cost (`accrue-usage-reconciliation.ts`) and container runtime (`accrue-session-end.ts`), all through `accrue` in `src/features/billing/api/accrue.ts` (retry, unknown sessions, settlement fallback) and `recordSessionUsage` in `src/features/billing/api/record-session-usage.ts`, which adds each event's exact cost to the session total. The relay, the Anthropic webhook and the billing cron all feed it. Provider list cost includes native web search.

| Entry point | Spend check before provider work | Where the cost is recorded |
|---|---|---|
| Open a chat (`POST /api/sessions`, a task from Library files, ask the agent from Memory) | The gate for the creator in `startChatSession`, `session-runtime/api/start-chat-session.ts`, before the provider session exists | Session metering |
| Send a message (`/api/sessions/[id]/send`, including a deferred chat's first message) | The gate for the sender in `sendSessionMessage`, `session-runtime/api/send-session-message.ts` | Session metering |
| Resume a paused session (a send, Resume, or the resume after a top-up) | The gate for the session's creator in `claimSessionResume`, `billing/api/claim-session-resume.ts`; a chat also takes a chats-at-once slot there | Session metering |
| Run a schedule now | The gate for the creator in `runTaskNow`, `tasks/api/task-lifecycle.ts` | Session metering |
| Scheduled run | The gate for the creator when the run is adopted (`tasks/api/adopt-task-run.ts`); a refused run is paused with the reason. Its budget is capped at the creator's allowance. | Session metering |
| Event-triggered run (Composio webhook) | The gate for the creator when the delivery is claimed (`tasks/api/trigger-delivery-transitions.ts`); a refused delivery starts nothing, is recorded `skipped` with the reason and sends the paused notice. Its budget is capped at the creator's allowance. | Session metering |
| Paid custom tools (`generate_image`, `edit_image`, `generate_video`, `generate_audio`, `transcribe_audio`, `web_search_exa`, `fetch_page`, `browse_page`, `browse_open`, `browse_act`) | The gate for the caller with the tool's `estimateCredits`, in the dispatcher (`tools/api/dispatch-execution.ts`) before the handler | `accrueToolCall` from `tools/api/tool-delivery.ts`, at the vendor's cost (the Gateway's through `resolveMediaCost`, Exa's reported cost, the Stagehand model cost), and a failure after the provider charged through `PaidToolError`; browser time, page reads included, through `accrueBrowserTime` in `tools/api/browser-lifecycle.ts` |
| Dictation (`/api/transcribe`) | The gate in `voice/api/transcribe-for-composer.ts`, estimated from the file size | `accrueVoiceTranscription` in `billing/api/accrue-voice.ts`, through `recordWorkspaceUsage` with no session |
| Read aloud (`/api/tts`) | The gate for the listener in `voice/api/synthesize-for-read-aloud.ts` | `accrueVoiceSynthesis` in `billing/api/accrue-voice-synthesis.ts`, charged to the listener |
| Tool approvals and results that continue a turn | None. The turn already passed the gate; the session's budget caps it. | Session metering |
| Native web tools and the sandbox browser | None beyond the session's budget | Session metering |
| Chat title generation | None | `accrueTitleGeneration` from `session-runtime/api/generate-session-title.ts`: a platform-paid `title_generation` row at the call's exact cost, zero credits, with `billing.platform_cost` telemetry |

---

## 8. Ours vs theirs: the boundary

We own `src/`. These services do their jobs and we never rebuild them:

| Service | We delegate |
|---|---|
| Better Auth | Auth flows, sessions, organizations, invitations and roles, in our Postgres database |
| Anthropic Managed Agents | Agent loop, tool execution, containers, streaming, memory, skills runtime, scheduled deployments |
| Composio | Third-party OAuth, tool execution and event triggers, behind our proxy (§1.4) |
| Stripe | Charges, Checkout, invoices, tax and the billing portal |
| Vercel Blob | Private file storage, signed reads and direct uploads |
| Vercel AI Gateway | Images, image edits, video, transcription and speech through one key |
| Exa | Web search and page contents |
| Browserbase | Hosted browsers for the `browse_*` tools |
| Resend | Requested and urgent transactional email |
| PostHog | Analytics, error tracking and logs in one project |

Postgres also holds the notification feed and realtime events (§5, §6).

---

## 9. Code layout

The live tree in `src/` is the evidence. The shape rules:

- **Routes do nothing.** `src/app/` parses input, calls a feature and returns through `withApiRoute`. `(auth)` is the sign-in surface. The product lives under `/app`, gated by its server layout ([03 §5](03-patterns.md#5-route-groups--auth-guard)). `(admin)` is the operator console. It returns 404 unless `NEXT_PUBLIC_ENABLE_ADMIN_ROUTES` is `true`, requires a signed-in user on every host except a loopback app, and env validation (`src/lib/env-schema.ts`) refuses that flag and `NEXT_PUBLIC_ENABLE_DEV_ROUTES` in production. The overlay registry and host live in `src/app/_overlays`.
- **`src/features/<name>/` holds the business logic** ([03 §1](03-patterns.md#1-feature-folder-shape)). Import boundaries are lint rules: API routes use a feature's `index.ts` or `server.ts`, shared layers never import features, and features sit in the ordered layers of `eslint-rules/feature-layers.mjs` ([01 §6](01-code-standard.md#6-files-and-modules), [decision 0040](../decisions/0040-layered-features.md)).
- **One caller resolver.** `src/lib/caller.ts` is the only reader of the auth session (`resolveUser`, `findCaller`, `resolveCaller` with an `atLeast` role). Lint rule `just-a-wrapper/no-direct-session-read` enforces it ([decision 0025](../decisions/0025-one-caller-resolver.md)). Roles and their order live in `src/lib/workspace-role.ts`.
- **One server-action boundary.** Mutating server actions return `ActionState` through `runAction` in `src/lib/action-state.ts`. Lint rule `just-a-wrapper/require-action-boundary` enforces it ([decision 0026](../decisions/0026-one-server-action-boundary.md)).
- **One writer per lifecycle column.** `eslint-rules/no-machine-status-write.mjs` maps each status, lease, trash, share and archive column to the one transitions file that may write it. `tests/eslint-rules/machine-owners.test.mjs` checks that every state machine has an owner ([decision 0014](../decisions/0014-lifecycles-are-state-machines.md)).
- **`src/components/`** holds UI primitives, icons and layouts. **`src/lib/`** holds stateless helpers. **`src/db/schema/`** groups tables by domain and is the data model. Better Auth's generated tables live there too; never add app columns to them. The auth session table is `auth_session`, so it does not collide with our `session`.
- **`content/`** holds per-fork content: starter pack, marketing copy, brand and legal. There is one Next.js app, with no `apps/` or `shared/` folder.

---

## 10. Vertical fork model

One deploy serves one product. A new niche is a fork: swap `content/`, the system prompt constants, the pricing configuration and the environment IDs, then redeploy. The `features/` code stays the same. There are no vertical configuration tables and no runtime switching ([decision 0006](../decisions/0006-forks-not-runtime-verticals.md)).

## 11. Environment separation: preview vs production

An agent's MCP proxy URL and an environment's networking are fixed when the provider records are created. So agents and environments exist per deploy environment. "Platform-wide" means across workspaces within one deploy environment.

- `scripts/seed-agents.ts` names records with the deploy environment (`VERCEL_ENV`, then `SEED_DEPLOY_ENV`, then `local`). It updates records in place, is safe to re-run and prints a dry-run plan without an API key.
- Previews share one long-lived preview set (one environment and one agent per tier), seeded once. Per-PR sets would orphan records.
- Development and preview share one non-production Anthropic workspace and key. Production has its own.
- Other per-environment resources: database branch, Stripe test or live mode, Composio project and key, Blob store, webhook registrations and scheduled deployments.
- Local development can use a Postgres in Docker instead of a Neon branch. `DATABASE_WS_PROXY` points the one Neon driver at a local WebSocket proxy (`applyLocalDatabaseProxy` in `src/db/local-proxy.ts`, used by the app and `scripts/db-migrate.ts`), and `docker-compose.dev.yml` runs both. A production deployment refuses the setting at startup ([decision 0045](../decisions/0045-local-postgres-through-the-neon-proxy.md)).

---

## 12. Tracing key flows

### 12.1 Signup and new member

Workspace actions commit the organization and membership rows before provisioning provider resources. A new personal workspace waits for provisioning before the app starts. Notification failures never undo provisioning.

```
/login (email code or Google; creates the user) → organization.create
  ├─ workspace provisioning → workspace row + workspace memory store
  └─ member provisioning (creator: workspace action; joiners: invitation action)
       → composio_user_id + user memory store + signed JWT in a vault
       → workspace_member row
```

The Stripe customer is created on the first top-up checkout (`ensure-customer.ts`). Roles live only on Better Auth's `member` row, read by join. Provisioning steps: `src/features/workspaces/api/provision.ts`.

### 12.2 Agent calls an MCP tool

Container → our proxy with the vault Bearer → verify the JWT → member's Tool Router URL → forward with `x-api-key` → response passes through (§1.4).

### 12.3 Turn with a custom tool

On `agent.custom_tool_use` the session goes idle with stop reason `requires_action` and blocking event IDs, and waits for one `user.custom_tool_result` per ID. Always post a result, success or `isError: true`. Destructive calls persist `pending_confirmation` rows resolved by a separate confirm request ([04 §11.1](04-observability.md#111-custom-tool-dispatcher)). A tool result is stored before it is delivered and before its cost is settled (`tool-delivery.ts`), so a retry never runs the tool twice.

### 12.4 Out of credits, top up, resume

The balance reaches zero → `user.interrupt` and `paused_no_credits` → banner → Checkout → the Stripe webhook grants credits, raises budgets and resumes recent pauses (§7). The relay sends heartbeats while upstream is quiet (`HEARTBEAT_MS` in `relay-frames.ts`). On reconnect the browser resumes from the last event it saw.

### 12.5 Scheduled task

Each cron task is one scheduled deployment created from `features/tasks/api/build-task-deployment.ts`: agent with a pinned version, environment, initial events, cron and timezone, vaults, resources, budget and `metadata.task_id`. The provider owns the tick, so there is no scan-and-fire and no double-fire lock ([decision 0005](../decisions/0005-anthropic-owns-scheduled-runs.md)).

- A run inherits the deployment's vaults and resources, so it gets the creator's connected apps exactly like chat.
- `adopt-task-run.ts` maps a run back to its task by `metadata.task_id` and `deployment_id` together.
- The task row is the truth and the provider follows it ([decision 0035](../decisions/0035-tasks-are-the-truth-and-providers-follow.md)). An edit, pause, resume or delete writes the row, bumps `task.version` and marks `task.provider_sync` in one statement; `sync-task-provider.ts` then pushes the row to the deployment under a lease, and the recovery sweep finishes any mark a request left behind.
- An edit names the version it read. Of two edits from the same version, one wins and the other gets `CONFLICT`.
- Run now holds a lease that ends when its run is adopted or refused; after an unanswered call the sweep settles it from the deployment's run log.
- Creation and edits share the deployment builder. Grounding must resolve before a deployment write. A definite provider rejection removes the creation; an uncertain result keeps its correlation ID for recovery (§14).
- Creating, resuming and resume-by-edit take a schedule slot under the plan lock (`assertCanCreateScheduledTask` in `tasks/api/assert-schedule-limit.ts`). Event tasks share the same pool of slots.
- Only the task's creator can change, run or delete it (`taskWritableBy` in `tasks/api/task-visibility.ts`). Teammates can read a shared task (`taskVisibleToViewer`).

### 12.6 Event-triggered task

Composio trigger → `/api/webhooks/composio` (signature verified) → claim the signed delivery → start a session as the task's creator with the payload in the kickoff message (`tasks/api/handle-trigger.ts`). The claim passes the spend gate for the creator; a refused delivery is recorded `skipped` with reason `credits` or `member_limit`, starts nothing and sends the paused notice. The session's budget is capped at the creator's remaining allowance (§7.1).

A task runs at most `EVENT_TASK_MAX_LIVE_RUNS` (3) runs at once. A delivery past that is recorded as `skipped` with reason `run_limit` and starts nothing. Pause and delete push to the trigger instance through the same provider sync as schedules.

A receipt completes only after the session leaves its creation and opening states. Recovery never revives hidden sessions or retries their opening message.

### 12.7 Session ends: billing and notification

A healthy turn ends with `session.status_idled`. `status_terminated` means an unrecoverable error or archive ([reference](https://platform.claude.com/docs/en/managed-agents/reference#event-types)), so billing cannot wait for it. The HMAC-verified `/api/webhooks/anthropic` is the trigger that does not need a browser:

- `status_idled`: sync the status, then run four independent jobs side by side: on `requires_action` dispatch pending custom tools and gates as the creator, complete a finished task run, reconcile usage, and settle artifacts. One failure fails the delivery after the others finish; each job is idempotent, so redelivery is safe.
- `budget_reached`: pause the session (`pauseSessionForBudgetReached`).
- `status_terminated`: complete the task and record the termination before reconciling usage.

Lookup failures propagate to the HTTP boundary so the provider redelivers. Event-keyed accrual makes retries safe. Dispatch: `src/features/webhooks/anthropic-dispatch.ts`.

### 12.8 File upload

Browser → upload-token route → private Blob upload → `/api/files/sync-metadata` → `file` row and thumbnail. Composer uploads report `uploadSource: chat`; a separate request mounts the saved file into the session.

### 12.9 Session creation and event delivery

`startChatSession` (`session-runtime/api/start-chat-session.ts`) takes the tier, session kind, permission mode and whether to defer the opening message. It reads the budget and memory resources, then `create-managed-chat-session.ts` sends the create request with SDK retries off, because the call is not idempotent.

Every opening message, deferred or not, reaches the provider through `sendOpeningMessage` in `session-runtime/api/start-turn.ts` and the same `sendMessage` as any other send. A chat turn starts at its opening, at a send into an idle chat and at a resume from a credit pause; each passes the chats-at-once limit under the workspace capacity lock (`withChatCapacity`, [decision 0034](../decisions/0034-send-leases-and-turn-starts.md); `claimSessionResume`, [decision 0037](../decisions/0037-one-spend-gate.md)). A chat holds a slot while its status is in `CHAT_SLOT_STATUSES` (`sessions/lib/session-machine.ts`).

- `session-event-relay.ts` owns SSE framing and request lifetime.
- `relay-frames.ts` opens the live stream before listing history, deduplicates persisted IDs and tails the stream.
- `sessions/lib/relay-translator.ts` turns provider events into chat events.
- Billing and analytics side effects run in `schedule-relay-effects.ts`. Upstream event IDs keep concurrent relays from writing twice.
- The grounding retry runs only on the provider's rejection of `system.message` for an unsupported model ([provider rule](https://platform.claude.com/docs/en/managed-agents/events-and-streaming#supported-models)).

---

## 13. Access rules

Who can read, write and share each resource, and where each rule is enforced, is in [13-privacy.md](13-privacy.md). The decisions behind it: [0020](../decisions/0020-private-by-default-teams.md) (private by default), [0028](../decisions/0028-separate-read-and-write-grants.md) (read and write grants), [0029](../decisions/0029-share-links-checked-on-use.md) (share links checked on use) and [0030](../decisions/0030-writable-folder-paths.md) (writable folder paths).

---

## 14. Recovery and purge

Three cron routes run daily from `vercel.json`. Each requires `CRON_SECRET`. A paid Vercel plan or an external scheduler can run recovery every few minutes.

| Route | Entry point | What it covers |
|---|---|---|
| `/api/cron/recovery` | `runRecoverySweeps` in `src/features/jobs/api/recovery-sweeps.ts` | Session creation and status, timed-out browsers, task state, unconfirmed sends, notification email retries, deployment snapshots, member cleanup, tools of removed creators |
| `/api/cron/billing` | `runBillingRecovery` in `src/features/jobs/api/billing-recovery.ts` | Pending budget syncs, automatic top-up attempts, unsettled session usage, stale tool deliveries, and webhook receipts older than 90 days (the newest Stripe receipt and unfinished Composio deliveries stay) |
| `/api/cron/purge` | `runPurgeJobs` in `src/features/workspaces/api/run-purge-jobs.ts` | Realtime rows, deleted workspaces and users, stored files, member cleanup, connection disconnects, rate-limit rows. Accepts only `dryRun=true`. |

Invariants the sweeps rely on:

- Every lifecycle is a state machine with one writer (§9). Session transitions compare a row version, so late work cannot overwrite a newer claim.
- Only a provider 404 proves a session is missing. Other errors stay retryable.
- An ambiguous opening send keeps its claim. An unconfirmed send is not reclaimed until provider history shows whether it arrived.
- A send holds a lease on the database clock (`session_send.recover_after`). Recovery takes over only a lapsed lease, and only the token holder can settle the attempt ([decision 0034](../decisions/0034-send-leases-and-turn-starts.md)).
- Failed creations interrupt running provider sessions before archiving them. `provider_archived_at` is recorded after success, so cleanup stops.
- A hidden session is terminal and an archived one is hidden (`session_hidden_check`, `session_archive_check`). The sweep archives rows matching `awaitingProviderArchive`.
- Recovery discovers missed scheduled runs from provider history. Overdue one-off schedules are archived even when no run exists, so they cannot repeat a year later.
- Deployment reconciliation compares a stored fingerprint of agent configuration, workspace skills, task instructions and what the run is told about its creator (name, time zone, reply language, workspace name). A changed fingerprint marks the task for a definition push through the same builder as edits. Saving a name, time zone or language pushes the person's live schedules at once (`scheduleCreatorTaskSync`); the reconciliation is the fallback.
- Deleting a workspace refunds only unfulfilled payments (`refund-deleted-workspace-payment.ts`). Fulfilled invoices and top-ups stay paid. Subscription cancellation runs through workspace deletion recovery.
- The stored-file sweep aborts a prefix when it would remove more than half of its listed objects and more than 100 of them, counting only objects nothing explains: bytes of an expired trash row or of a purged workspace or account do not count (`sweep-stored-files.ts`, [decision 0036](../decisions/0036-per-person-saves-and-explained-removals.md)).
