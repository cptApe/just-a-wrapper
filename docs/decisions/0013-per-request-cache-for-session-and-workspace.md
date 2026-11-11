# Per-request cache for session and workspace

- **Status:** Accepted
- **Date:** July 2026 (session), November 2026 (workspace)

## Context

Nested layouts and pages all need the current session and workspace, and they render in parallel. Each could fetch its own copy.

## Decision

Two reads are wrapped in React's `cache()` so all callers in one server request share one result: [`getRequestSession`](../../src/lib/request-session.ts) and [`ensureRequestOrganization`](../../src/features/workspaces/api/ensure-request-organization.ts).

## Why

The session cache keeps nested layouts on one `auth.api.getSession` round trip, so resolving the workspace adds no extra auth read per navigation. `getRequestSession` takes no arguments on purpose, so every caller hits the same cache entry.

The workspace cache fixes a bug found in November 2026. A layout and its page render in parallel, so a page could not assume the shell gate had already created the workspace. A first sign-up could see a "workspace missing" message. Both now await the same resolution.

## Consequences

- Read through these functions in layouts and page loaders.
- `cache()` lasts for one server request only. It is not a cross-request cache.
- Do not add a second path that creates the personal workspace.
