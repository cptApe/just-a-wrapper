# Optional providers are resolved once at startup

- **Status:** Accepted
- **Date:** November 2026

## Context

Web search, the browser, email, media, billing, Google sign-in and connected apps are all optional for someone running their own copy. A tempting way to handle this is to try a provider at each call site and fall back to another.

## Decision

[`capabilities.ts`](../../src/lib/capabilities.ts) resolves each option once from validated configuration into a typed value such as `{ kind: 'exa' }` or `{ kind: 'off' }`. Code asks the capability and runs exactly one path. Application startup ([`runtime-capabilities.ts`](../../src/lib/runtime-capabilities.ts)) and the agent seed plan ([`seed-plan.ts`](../../src/features/agent-setup/seed-plan.ts)) call the same pure resolver, `resolveCapabilitiesFromEnv`. The seed script and the agent prompt drift check both build that seed plan.

A capability that is off is a typed value. The UI says why it is off and which setting turns it on, and the agent is not offered tools that are off. A capability that is on but broken throws.

## Why

The [code standard](../spec/01-code-standard.md#2-configuration-and-providers) bans runtime cascades. One resolver also keeps the agent's declared tools, the dispatch registry and the Tools page in agreement, because all three filter through `isToolAvailable` in [`declarations.ts`](../../src/features/tool-catalog/declarations.ts).

## Consequences

- Adding a provider means adding a variant, handling it everywhere the compiler points, and re-seeding the agents.
- Each tool declaration names its own `gate`. `GATE_BY_NAME` in `src/features/tool-catalog/declarations.ts` collects them, with `BUILTIN_TOOL_GATES` for the two built-in web tools, so it is the one map from a tool to the capability that offers it.
- Only `src/lib/env.ts` reads configuration from `process.env`. A few platform keys (`NODE_ENV`, `NEXT_RUNTIME`, `VERCEL_ENV` and the inlined `NEXT_PUBLIC_*` keys) are read directly, as `eslint-rules/no-raw-env-read.mjs` allows.
- Do not switch providers at runtime or read a key directly in a feature.
