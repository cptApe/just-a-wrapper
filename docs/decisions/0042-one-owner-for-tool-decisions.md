# One owner for tool decisions, read through context

- **Status:** Accepted
- **Date:** November 2026

## Context

A tool call can wait on the person in two ways. A built-in or connected-app call is gated by the provider and relayed to the chat; a custom tool is held by our dispatcher in `pending_confirmation`. The chat view had one hook for each (`use-tool-gates`, `use-custom-tools`). Both built the same request store, repeated the "is this task stopped" check, and the view hook routed each click back to the right one. The result travelled as five parallel props (pending ids, remembered ids, busy ids, owner flag, resolve callback) from the view through the thread, the turn and the row into each tool line. Chains and sub-agent lanes passed some of them and not others, and props such as "busy" without "pending" still type-checked.

Two visible faults came from the split. An approval inside a collapsed sub-agent row could not be seen, so the task waited on a button nobody could find. "Always allow this" was offered on every relayed gate, but the server can store it only for real connected-app actions, so on the others it failed every time.

The header kept title and pin in a third cache next to the sidebar row and the page's session prop, with two effects copying values between them.

## Decision

- `useToolDecisions` (`src/features/chat/hooks/use-tool-decisions.ts`) owns both sources: the relayed gates in the event fold and the custom calls the server holds. It keeps one request store and answers either kind (`api/tool-decision-requests.ts`). `toolsStopped` in `lib/chat-turns.ts` is the one place that says a terminated or credit-paused task takes no decision.
- The pure part lives in `lib/tool-decisions.ts`. `selectPendingDecisions` builds one map of waiting calls, and `toolGateOf` turns it into one union per line: `none`, `pending` (with `busy`, `remember` and `resolve`) or `readonly` for a viewer who cannot decide.
- `ChatView` puts the decisions in `ToolDecisionsContext`. Each tool line reads `useToolGate(id)`; the thread's fold and the sub-agent lane read `useToolDecisionsView()`. No component between the view and the line carries gate props.
- The remembered approval follows the server contract, `approvalScopesFor(readGatedCall(...))` from permissions: "Always allow this" only when a Tools page setting exists for the call and the viewer owns the task, else "Allow for this task" when the task can remember it, else no options arrow.
- A sub-agent row opens while one of its calls waits on a decision and stays open afterwards.
- The header derives title and pin from the sidebar's session row, falling back to the session prop. The shared session edits write the row optimistically and roll it back. A task the loaded sidebar pages do not hold keeps its own edits in local state.

## Why

One owner means one place to fix approval behaviour, and one union means a line cannot show a busy card that is not pending. Context fits because the decision state belongs to the task, and every line in it needs the same answer. Keeping the decision map's identity while nothing about a decision changes keeps memoized turns from re-rendering on every streamed frame.

## Consequences

- A new surface that shows tool lines gets correct gates by rendering inside `ToolDecisionsContext`; outside it, every line reads `none`.
- Adding a gate source means adding it to `selectPendingDecisions` and to the router in `useToolDecisions`, not threading new props.
- The header follows whatever the sidebar row says, including a rename from another tab once the list refetches.
