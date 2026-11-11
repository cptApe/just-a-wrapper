# Read and write access are separate grants

- **Status:** Accepted
- **Date:** November 2026

## Context

A shared task can be read by every member but steered only by its creator. Session routes first loaded a visible session, then called a second assert for the creator. Five routes each had to remember that second call. Task writes were authorized with the read predicate, so a shared scheduled task accepted edits from any member.

## Decision

[`session-access.ts`](../../src/features/sessions/api/session-access.ts) issues two grants. `authorizeSessionAccess` returns a `SessionReadGrant` for transcript reads and relay attaches. `authorizeSessionWrite` returns a `SessionWriteGrant`, which carries a type brand that only that function adds. Functions that steer a session (send, interrupt, approve, browser control, feedback) take a `SessionWriteGrant`, so passing a read grant fails the type check.

Tasks use two predicates in [`task-visibility.ts`](../../src/features/tasks/api/task-visibility.ts): `taskVisibleToViewer` for reads and `taskWritableBy`, creator only, for writes.

## Why

A rule that every route must remember is broken by the next route. A type that cannot be built without the check makes the compiler hold the rule.

## Consequences

- A new write path asks for `SessionWriteGrant` in its signature. Do not widen it to `SessionReadGrant` or `CallerSession`.
- `authorizeSessionIdentityWrite` covers rename, pin and delete, which work before the upstream session exists.
- Do not cast to `SessionWriteGrant` anywhere else.
- The full access table is in [13-privacy.md](../spec/13-privacy.md).
