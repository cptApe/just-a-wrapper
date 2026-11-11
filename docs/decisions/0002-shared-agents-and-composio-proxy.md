# Shared agent records behind one Composio proxy

- **Status:** Accepted
- **Date:** April 2026 (design), June 2026 (shipped)

## Context

Each member connects their own apps through Composio, so every agent call must reach Composio as that member. Two platform facts conflict:

- Composio binds a member to a URL when the URL is minted. Its only header is `x-api-key`, and that key covers the whole Composio organization.
- Anthropic vaults inject only `Authorization: Bearer` on MCP calls. They cannot send `x-api-key` or any other header name.

A shared agent record therefore cannot point straight at Composio. The obvious fix is one agent per member, created at signup.

## Decision

Agent records are platform-wide: one per intelligence tier, shared by all tenants in an environment. Each has a single MCP entry that points at our proxy, [`/api/mcp/composio`](../../src/app/api/mcp/composio/route.ts).

The vault holds a per-member JWT that we sign. The proxy verifies it, finds the member's Tool Router URL and forwards the call with `x-api-key`. See [02-foundation.md §1.4](../spec/02-foundation.md#14-the-mcp-proxy).

Per-member variation goes in vault IDs, session resources and memory stores. There is no custom-instructions field.

## Why

One agent per member would spend an `agents.create()` call at every signup. The proxy costs one function and an extra 50 to 100 ms per MCP call. Agent creation at signup is zero.

## Consequences

- A new record is needed only when the persona changes: model, system prompt, tools or skills.
- The model picker is a list of tiers, because a session cannot override an agent's model.
- Personalization belongs in memory. Do not add per-member agent updates or a settings field that feeds the system prompt.
- Agent and environment records hold the proxy URL and egress list at create time, so re-seed after changing them.
