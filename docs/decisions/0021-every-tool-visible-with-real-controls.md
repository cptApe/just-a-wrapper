# Every tool is visible, with real approval settings

- **Status:** Accepted
- **Date:** July 2026

## Context

New custom tools went live but never appeared on the Tools page. People could not see or control what the agent could do.

## Decision

Every custom tool the app supports has a row on the Built-in shelf, with the same allow, ask and block settings as any other tool. Rows live in [`constants.ts`](../../src/features/permissions/constants.ts). A tool that always pauses for a person (declared `alwaysAsk`: Library and schedule deletion, and saving, updating or deleting a skill) shows a fixed "Always asks you" row and no control that would mislead. The row's state comes from `decideBuiltinToolGate`, the same function the dispatcher runs ([decision 0033](0033-what-an-agent-may-do-without-a-person.md)).

Tool names are one union, `CustomToolName`, derived from `TOOL_DECLARATIONS` in [`declarations.ts`](../../src/features/tool-catalog/declarations.ts), and the shelf rows are typed against it. A tool with no row fails the type check, and [`builtin-shelf.test.mjs`](../../tests/permissions/builtin-shelf.test.mjs) fails if the registry and the catalog differ.

## Why

People must be able to see and govern everything the agent can do. A control that does not change behaviour misleads them. A test makes the rule hard to forget when a new tool ships.

## Consequences

- Adding a custom tool includes its shelf row in the same change.
- Anthropic's `always_ask` does not cover custom tools, so our dispatcher enforces their approval.
- Do not ship a hidden tool or a toggle that has no effect.
