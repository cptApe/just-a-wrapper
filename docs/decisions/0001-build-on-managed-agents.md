# Build directly on Managed Agents primitives

- **Status:** Accepted
- **Date:** April 2026

## Context

The product is an agent workspace: chat, files, memory, connected apps, skills and scheduled work. An agent loop, tool execution, containers, memory and a run scheduler are all hard to build and keep running. Anthropic Managed Agents offers each of these as a primitive.

## Decision

We use the Managed Agents primitives as they are: agents, environments, sessions, events, memory stores, skills, vaults, files and scheduled deployments. We never add our own parallel layer over them. The table in [02-foundation.md §1.1](../spec/02-foundation.md#11-primitives-at-a-glance) lists what each one does for us.

## Why

The value of the product sits in the harness people use, not in a second agent runtime. This has been the rule since the first spec.

The rule has a simple test: if a new term needs a paragraph of definition and is not in that table, we do not add it. The spec rules out:

- A plugin system. Starter packs are deploy-time config.
- A workflow graph engine. A workflow is a task with instructions and a trigger.
- Slash commands. People type prompts.
- Team agents and vertical config tables. A new niche is a fork ([0006](0006-forks-not-runtime-verticals.md)).

## Consequences

- We accept the platform's limits. [0003](0003-append-only-sessions-no-fork.md) and [0004](0004-mid-turn-messages-use-the-platform-queue.md) are two examples.
- Managed Agents is in beta, so API shapes can move. Verify shapes against the SDK or official docs, not memory.
- Do not wrap a primitive in an adapter "in case we switch". The code standard allows adapters only with [two real implementations](../spec/01-code-standard.md#1-design).
