# Decisions

This folder records the design decisions a new contributor might otherwise question or undo. Each file says what the problem was, what we chose, why, and what the choice makes harder. When code and a decision disagree, the code shows what is true today and the decision needs updating. A decision that no longer holds is marked superseded or gets a dated note; it is not rewritten.

A new decision takes the next number and has the sections Status, Date, Context, Decision, Why and Consequences, plus a row in the table below.

The code was developed privately and published as a single commit, so these files replace the commit history as the record of why things are the way they are.

| Number | Title | Status |
| --- | --- | --- |
| [0001](0001-build-on-managed-agents.md) | Build directly on Managed Agents primitives | Accepted |
| [0002](0002-shared-agents-and-composio-proxy.md) | Shared agent records behind one Composio proxy | Accepted |
| [0003](0003-append-only-sessions-no-fork.md) | Sessions are append-only, with no fork or message edit | Accepted |
| [0004](0004-mid-turn-messages-use-the-platform-queue.md) | Messages sent mid-turn use the platform's queue | Accepted |
| [0005](0005-anthropic-owns-scheduled-runs.md) | Anthropic owns the schedule for cron tasks | Accepted |
| [0006](0006-forks-not-runtime-verticals.md) | A new niche is a fork, not runtime configuration | Accepted |
| [0007](0007-feature-folders-and-thin-routes.md) | Feature folders and thin routes | Accepted |
| [0008](0008-typed-errors-and-no-silent-catches.md) | Throw typed errors and never swallow them | Accepted |
| [0009](0009-capabilities-resolved-once.md) | Optional providers are resolved once at startup | Accepted |
| [0010](0010-custom-eslint-rules-keep-standards.md) | Custom ESLint rules enforce the standards | Accepted |
| [0011](0011-one-form-primitive.md) | One Form primitive with Cmd+Enter | Accepted |
| [0012](0012-integration-tests-on-real-postgres.md) | Tests prove behaviour: real Postgres, real modules, no source text | Accepted |
| [0013](0013-per-request-cache-for-session-and-workspace.md) | Per-request cache for session and workspace | Accepted |
| [0014](0014-lifecycles-are-state-machines.md) | Every lifecycle is an explicit state machine | Accepted |
| [0015](0015-meter-from-actual-provider-cost.md) | Meter usage from the provider's actual cost | Accepted |
| [0016](0016-one-credit-one-margin.md) | One credit equals one cent, with one margin setting | Accepted |
| [0017](0017-pro-and-max-subscription-plans.md) | Sell Pro and Max subscription plans | Superseded by 0018 |
| [0018](0018-sell-credits-only.md) | Sell credits at cost through one top-up dialog | Superseded by 0047 |
| [0019](0019-grant-top-ups-on-the-database-clock.md) | Grant top-ups on the database clock | Accepted; extended to the whole ledger by 0032 |
| [0020](0020-private-by-default-teams.md) | Private by default, with one Team folder | Accepted |
| [0021](0021-every-tool-visible-with-real-controls.md) | Every tool is visible, with real approval settings | Accepted |
| [0022](0022-composio-with-one-shared-account-per-app.md) | Composio for connected apps, one shared account per app | Accepted |
| [0023](0023-exa-finds-browserbase-reads.md) | Exa finds pages and Browserbase reads the hard ones | Accepted |
| [0024](0024-postgres-and-sse-for-live-state.md) | Postgres and SSE for live state and notifications | Accepted |
| [0025](0025-one-caller-resolver.md) | One caller resolver | Accepted |
| [0026](0026-one-server-action-boundary.md) | One server action boundary | Accepted |
| [0027](0027-enforced-feature-boundaries.md) | Enforced feature boundaries instead of one public door | Accepted; edge map superseded by 0040 |
| [0028](0028-separate-read-and-write-grants.md) | Read and write access are separate grants | Accepted |
| [0029](0029-share-links-checked-on-use.md) | A share link's grant is checked each time it is used | Accepted |
| [0030](0030-writable-folder-paths.md) | Writing into a folder path needs every existing folder on it to be writable | Accepted |
| [0031](0031-round-once-per-session.md) | Round credits once per session, not per model request | Accepted |
| [0032](0032-one-ledger-clock-and-explicit-payment-records.md) | One ledger clock and explicit payment records | Accepted |
| [0033](0033-what-an-agent-may-do-without-a-person.md) | What an agent may do without a person | Accepted |
| [0034](0034-send-leases-and-turn-starts.md) | A send holds a lease, and a turn starts in one place | Accepted |
| [0035](0035-tasks-are-the-truth-and-providers-follow.md) | The task row is the truth, and the provider follows it | Accepted |
| [0036](0036-per-person-saves-and-explained-removals.md) | Saves are per person, and the storage sweep stops only on removals nothing explains | Accepted |
| [0037](0037-one-spend-gate.md) | One spend gate for every paid entry point | Accepted |
| [0038](0038-every-browser-on-a-row.md) | Every browser is on a row, and every paid tool bills its failures | Accepted |
| [0039](0039-notification-switches-come-from-events.md) | Notification switches come from the events, and people controls say why before they refuse | Accepted |
| [0040](0040-layered-features.md) | Features sit in ordered layers | Accepted |
| [0041](0041-one-composer-draft.md) | One composer draft, one send-failure path | Accepted |
| [0042](0042-one-owner-for-tool-decisions.md) | One owner for tool decisions, read through context | Accepted |
| [0043](0043-one-way-to-format-values.md) | One way to format dates, times, numbers and sizes | Accepted |
| [0044](0044-one-way-to-load-and-change-server-data.md) | One way to load and change server data in the browser | Accepted |
| [0045](0045-local-postgres-through-the-neon-proxy.md) | Local Postgres through the Neon proxy | Accepted |
| [0046](0046-one-file-kind.md) | One answer to "what kind of file is this" | Accepted |
| [0047](0047-subscriptions-with-a-fenced-credits-only-mode.md) | Subscriptions are the billing mode; credits only is a fenced add-on | Accepted |
| [0048](0048-brand-and-contact-come-from-configuration.md) | Brand and contact details come from configuration | Accepted |
