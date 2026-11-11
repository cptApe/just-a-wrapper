# Postgres and SSE for live state and notifications

- **Status:** Accepted
- **Date:** November 2026

## Context

Sidebar state, credits, presence and notifications need to update live. Earlier versions used hosted providers: Ably for realtime and Knock for the notification feed.

## Decision

Both moved into the app. `publishWorkspaceEvent` and `publishSessionEvent` insert into a `realtime_event` table, and one shared browser connection reads `/api/realtime/stream`. Notifications are rows in our database, and email goes straight through Resend. See [02-foundation.md §6](../spec/02-foundation.md#6-real-time-state).

## Why

No longer argument for the replacement was written down. The facts that support it:

- The app already had Postgres and an SSE relay.
- Private task events go only to their creator, and visibility events carry no content.
- A new install needs only a database URL and a Claude API key ([README](../../README.md)).

## Consequences

- The stream polls about once per second, and purge removes events older than one day.
- Membership is checked on each poll, and the stream closes before the function time limit so the browser reconnects.
- Do not bring back a hosted realtime or feed provider without a measured need.
