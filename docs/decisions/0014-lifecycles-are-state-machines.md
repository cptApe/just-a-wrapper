# Every lifecycle is an explicit state machine

- **Status:** Accepted
- **Date:** November 2026

## Context

Sessions, tasks, payments, shares and browser leases each move through states. Webhooks arrive late or out of order, and processes crash between a claim and a provider call.

## Decision

Each persisted lifecycle has one table of allowed moves, built with [`defineStateMachine`](../../src/lib/state-machine.ts), and one transitions module that performs every write. Every write is a guarded update, and the caller handles a lost race by name. A terminal state has no moves out. Browser lifecycles use one pure reducer. See the [code standard](../spec/01-code-standard.md#10-state-machines).

## Why

Late work must not overwrite newer state, and replays must not leave a terminal state. A guarded update gives both with a plain SQL condition. A step that claims a row and then calls a provider needs a named in-between state and a way out after a crash, or the row stays stuck.

The billing and session recovery rules in [02-foundation.md](../spec/02-foundation.md) rely on these guarantees.

## Consequences

- `just-a-wrapper/no-machine-status-write` rejects lifecycle writes outside the owning module. Its ownership map in [`no-machine-status-write.mjs`](../../eslint-rules/no-machine-status-write.mjs) covers status columns and the other lifecycle columns: leases, trash (`deletedAt`), share revocation (`revokedAt`), visibility and archive or hide timestamps. Add every new lifecycle column to that map.
- [`machine-owners.test.mjs`](../../tests/eslint-rules/machine-owners.test.mjs) fails when a `defineStateMachine` does not declare what it persists, or when a persisted column has no owner in the map.
- Each table needs a unit test, and each guarded write an integration test.
- Do not hold a row lock across a provider call.
- One independent toggle does not need a machine.
