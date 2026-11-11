# Composio for connected apps, one shared account per app

- **Status:** Accepted
- **Date:** April 2026 (Composio), November 2026 (sharing)

## Context

Agents need OAuth access to many third-party apps. Sometimes a workspace also wants one account available to every member.

## Decision

Composio handles third-party OAuth, tool execution and event triggers, behind the [proxy](0002-shared-agents-and-composio-proxy.md). Tool Router loads actions on demand, and only the audited toolkits and actions in [`toolkits.ts`](../../src/lib/composio/toolkits.ts) are allowed.

Owners and admins can share one account per app with the workspace. A member's own connected account wins over the shared one. See [`shared-connections.ts`](../../src/features/integrations/api/shared-connections.ts).

## Why

Listing every tool up front is impractical; GitHub alone has 781 tools. Third-party OAuth and tool execution are services we delegate and do not rebuild ([02-foundation.md §8](../spec/02-foundation.md#8-ours-vs-theirs-the-boundary)).

No longer argument for the sharing rule was written down.

## Consequences

- An unknown toolkit slug can make Composio reject a whole session, so test a real session mint before adding one.
- Any change to shared or own accounts must clear the cached session URL.
- Only owners and admins can share an account.
- Do not call Composio directly from the agent or add per-app OAuth code.
