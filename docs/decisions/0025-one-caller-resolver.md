# One caller resolver

- **Status:** Accepted
- **Date:** November 2026

## Context

Seven functions turned a request into "who is calling and in which workspace". Each gave a different guarantee. Some never checked that the person was still a member.

The auth session holds an active-organization pointer. It can outlive a membership. Offboarding clears it in the same transaction, but a resolver that trusts the pointer alone is one missed code path away from letting a removed member in.

## Decision

[`src/lib/caller.ts`](../../src/lib/caller.ts) is the only reader of the auth session. It exports three functions:

- `resolveUser` returns the signed-in person, for surfaces that exist before or outside a workspace.
- `findCaller` returns the caller, or null when the person has no live membership.
- `resolveCaller` returns the caller or throws. The role is a parameter: `atLeast: 'admin' | 'owner'`.

Every caller resolution joins the current member row and a live workspace. The lint rule `just-a-wrapper/no-direct-session-read` keeps it that way.

## Why

One module means one guarantee. A removed member fails the same way on every surface, and a new surface cannot forget the membership check because there is nothing else to call.

## Consequences

- Use `resolveUser` before a workspace exists, for example preferences, profile images and account deletion.
- Add a file to the lint allowlist in `eslint.config.mjs` only if it manages the pointer itself: provisioning, switching, accepting an invitation.
- A signed-out call always throws `UNAUTHENTICATED`. A missing membership is always `WORKSPACE_NOT_FOUND`. A low role is `FORBIDDEN`.
- [`src/lib/request-session.ts`](../../src/lib/request-session.ts) is the other general reader; the three workspace files that move the active-organization pointer are allowlisted too (see `eslint.config.mjs`). Layouts and page loaders may use its `getRequestSession` for redirects. They must not read the pointer to decide access.
