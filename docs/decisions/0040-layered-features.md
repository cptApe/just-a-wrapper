# Features sit in ordered layers

- **Status:** Accepted. Supersedes the edge-map half of [decision 0027](0027-enforced-feature-boundaries.md).
- **Date:** November 2026

## Context

[Decision 0027](0027-enforced-feature-boundaries.md) listed every allowed feature-to-feature import in a generated map. The map recorded the graph but did not shape it: adding an edge was one line, so it grew to 170 edges with 30 pairs of features that imported each other and one longer cycle (chat, tools, scheduled). A lint error said an edge was missing but not where the code should go.

Most pairs had one of a few causes. UI kits (settings rows, admin sections, nav classes) lived inside a feature that other features imported, and that feature imported them back. Catalogs and constants sat above the code that read them. Three folders each held two features: `agents` (the Anthropic client and the seed plan), `sessions` (the session record and the runtime that composes files, memory, skills, permissions and tools) and `tools` (a pure catalog and the executor). Library items and session outputs were one library split across `files` and `artifacts`. Recovery sweeps that compose every feature lived low in `sessions`.

## Decision

Every folder in `src/features` has one row in an ordered table, `eslint-rules/feature-layers.mjs`:

| Layer | Features, in order |
| --- | --- |
| platform | agents, overlays, preferences, realtime, theme |
| kernel | notifications, sessions, billing |
| library | files, voice, auth, memory, skills, tool-catalog, permissions, integrations |
| runtime | session-runtime, tasks |
| capabilities | search, agent-setup, tools |
| product | workspaces, webhooks, jobs, chat, feedback, scheduled |
| chrome | shell, settings, admin, landing |

A feature imports a feature in a lower layer, or one listed before it in its own layer. `just-a-wrapper/no-upward-feature-import` checks each import against the table, so no two features import each other and no cycle can form. Its error names both layers and says what to do: move the shared piece down, or pass the behaviour in as a parameter or prop. A unit test fails when a folder is missing from the table or listed twice. `pnpm layers` (`scripts/feature-edges.mjs`) reports the edges, the same-layer edges and any cycle; it writes nothing.

To reach this graph:

- The UI kits moved to `src/components/settings`, `src/components/admin` and `src/components/layouts`. Shared constants and lookups moved to `src/lib`: the Composio toolkit catalog (`src/lib/composio/`), workspace identity, the file content URL, the credits copy, the admin prompt format and the search query keys. The search key factory in `src/lib` is an exception to "each feature owns its key factory" (code standard 4.3): sessions invalidates search results when a session changes, and sessions sits below search.
- `agents` keeps the Anthropic client, tier config and agent types; the seed plan, system prompts, prompt registry and drift check are `agent-setup`. `sessions` keeps the session record (types, access, transitions, shares, the message wire format, client caches, `sendMessage`); starting, sending, relaying, gating and reconciling sessions are `session-runtime`. `tools` keeps execution; the pure declarations are `tool-catalog`, which also holds the built-in tool names.
- `artifacts` merged into `files`.
- `jobs` holds the recovery sweeps and the daily billing recovery, which compose sessions, tasks, tools, integrations and billing. The cron routes and the shell layout call `@/features/jobs/server`.
- The schedule read model moved from `scheduled` into `tasks`; `scheduled` is the page.
- Deleting an account is a workspace operation, so its action and section live in `workspaces`, and the account settings page renders the section below the profile form.

## Callers pass behaviour that sits above the callee

Some calls run from a low feature into a higher one. These take the behaviour from their caller instead of importing it:

- The stale-session reconcile dispatches the pending tool calls of a session that stopped on `requires_action`. The dispatcher is the tools feature's `dispatchSessionActions`, which sits above the runtime. `reconcileWorkspaceSessions`, `reconcileAllSessions`, `listWorkspaceSessionsPage`, `createInteractiveChat`, `sendSessionMessage` and the chat branch of `startChatSession` take it as a required `dispatchPendingToolCalls` parameter. The jobs sweeps, the sessions and send routes, the shell sidebar loader and the two "start a task" actions pass it. A required typed parameter cannot be forgotten the way a registry entry can, and recovery runs exactly when it did before: inside the reconcile, on the user's request when that request reconciles. Moving the dispatch to a later sweep was rejected because it would delay recovery of a missed webhook.
- `reconcilePendingBilling` takes the tools feature's `reconcileToolDeliveries` from the jobs caller, so it stays one work item in the same batch, under the same deadline, with the same failure count.
- Deleting a session from the sidebar or the task header takes chat's `discardDraft` as `onDeleted`.
- The Library page passes the memory "ask the agent" action and the files "new task with files" action as props, because both start a session and need the dispatcher. Both actions live in `chat` (`chat/api/memory-update-actions.ts`, `chat/api/new-task-with-files.ts`), which sits above tools. The memory action keeps the memory action's error messages through `memory/api/memory-errors.ts`.
- The Library page passes the Memory pane its search results (`renderSearchResults`, built from the search feature's `MemorySearchResults`), because search sits above memory and already reads its stores.
- Settings → General passes the preference rows their save actions. The actions live in `settings/api/preference-actions.ts`, above both preferences and tasks, because a saved time zone or language pushes the person's scheduled tasks (decision 0035).

## Why

A layer table states the architecture as an order, which a reader can hold in their head, and each import can be checked on its own, so the rule runs in the editor. A cycle check alone needs the whole graph and says only that a cycle exists. The table also tells a newcomer where code goes: put it in the lowest layer whose features it needs.

## Consequences

- A new feature adds a row to `eslint-rules/feature-layers.mjs` in the same change. Reordering the table is an architecture change and is reviewed as one.
- The lint cache key includes a digest of `eslint-rules/`, because ESLint keys its cache on the resolved config, which does not include rule source or data files. A change to the table re-lints every file.
- Pages, layouts and features may still import any file of a feature they may reach. Routes still use a feature's `index.ts` or `server.ts`.
