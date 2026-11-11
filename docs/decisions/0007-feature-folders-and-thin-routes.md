# Feature folders and thin routes

- **Status:** Accepted; the public-surface sentence is narrowed by [0027](0027-enforced-feature-boundaries.md)
- **Date:** April 2026 (layout), July 2026 (route boundary)

## Context

A product this size has many domains: chat, billing, files, memory and more. Each needs a clear home for its logic and a clear public surface.

## Decision

Business logic lives in `src/features/<feature>/`. A route parses input, calls a feature API and returns through `withApiRoute` in [`route-kit.ts`](../../src/lib/route-kit.ts). A feature's public surface is its `index.ts`, with `server.ts` for what only routes need and a separate browser entry where client code needs one. [Decision 0027](0027-enforced-feature-boundaries.md) narrows this sentence: the public surface binds API routes, while features and pages follow the rules in 0027. Shared code goes in `src/lib/`, `src/hooks/` or `src/components/`. There is no `apps/` wrapper, `shared/` folder or `utils.ts` grab bag.

See the [code standard](../spec/01-code-standard.md#6-files-and-modules) and [patterns](../spec/03-patterns.md#1-feature-folder-shape).

## Why

The folder tree tells a new reader what the app does. In July 2026 we added `withApiRoute` so every route has one boundary and one error shape, `{ error: { code, message } }`.

## Consequences

- `just-a-wrapper/no-deep-feature-import` keeps API routes on each feature's public doors.
- Client file UI must import `@/features/files/browser`, never the server barrel.
- Do not add per-route error handling or a second response shape.
- Do not add a feature folder for what is really a page or a single file utility.
- `src/lib/utils.ts` holds only the `cn` class-name helper. Do not add other helpers to it.
