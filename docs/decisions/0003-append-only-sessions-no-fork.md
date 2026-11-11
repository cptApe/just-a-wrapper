# Sessions are append-only, with no fork or message edit

- **Status:** Accepted
- **Date:** June 2026

## Context

Other chat products let a person edit an old message and branch the conversation, or regenerate a reply. We looked at whether we could offer this.

## Decision

We do not offer message editing, regenerate or conversation forks.

## Why

The conversation lives on Anthropic's side as an event log that the app does not own. The SDK (checked at 0.116.0) exposes only `list`, `send` and `stream` for session events. Nothing changes or removes an event. `sessions.create` has no way to seed a new session with earlier turns, and no user event can inject a past agent message. Session threads are multi-agent execution threads, not conversation branches.

We considered three ways around this:

- Start a new session and replay only the user's turns. The agent regenerates everything, which is expensive and does not reproduce the original conversation.
- Move chat to the plain Messages API and own the transcript. Forking becomes easy, but we lose the managed container, tools, skills and memory. That conflicts with [0001](0001-build-on-managed-agents.md).
- Ask for a platform fork primitive. None exists yet.

The local Agent SDK has fork and rewind features. They belong to a different runtime.

## Consequences

- The thread stays simple and matches what the model actually saw.
- Do not build edit or regenerate on top of a session. If the platform adds a fork or seed primitive, reopen this decision.
