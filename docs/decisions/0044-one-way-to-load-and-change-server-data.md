# One way to load and change server data in the browser

- **Status:** Accepted.
- **Date:** November 2026

## Context

Most client data went through React Query, with `optimisticMutation` for writes whose result is known in advance. Five hooks did not. Toolkit permissions loaded in an effect and rebuilt snapshots, a revision ref, a serial write queue and reconcile-on-failure with its own reducer. The integration panel read its status in an effect and ran the sign-in poll from another effect. The composer read its credit balance in an effect with its own attempt tokens. Search "Ask agent" and the top-up button each hand-built an attempt guard around one request. Other components could not read or invalidate any of that data, and each hook carried its own copy of the stale-response guard.

## Decision

React Query and `optimisticMutation` are the only way the browser loads and changes server data.

- **Reads are queries under the feature's key factory.** New keys: `permissionQueryKeys.toolkit`, `integrationQueryKeys.status`, `billingQueryKeys.composerCredits`, `adminQueryKeys.openGraphImage`. `billingQueryKeys.topup` is the top-up mutation key. Every client key roots on the organization id, named `organizationId`, the client's tenant scope. A read that must be fresh on every open sets `gcTime: 0`.
- **Writes are mutations.** Toolkit permission writes spread `optimisticMutation` and share one mutation `scope`, so the database applies them in the order the person made them; the hand-built queue is gone. Search "Ask agent" uses `useCreateSession`, the same create mutation as Home.
- **Long waits are mutations too.** Waiting for an OAuth sign-in (`waitForSignIn` in `integrations/lib/sign-in-flow.ts`) is a mutation that polls the shared status query; an abort signal ends it when the person acts again or closes the panel.
- **Effects only subscribe.** An effect may listen to the window or a timer and call `invalidateQueries`; it never calls `fetch`, `fetchJson` or a server action. `just-a-wrapper/no-effect-fetch` enforces this in `src/features/**`, following calls through functions in the same file.
- **The admin console has a `QueryClient`** (`AdminDataProviders`), with the app's defaults and no workspace.

Three effects keep their requests and are named in the rule's allowlist, each with a reason: the chat event stream and its access probe, the Stripe return reconcile (arriving back is the event) and the live Browserbase panel (a bounded status poll and a control lease heartbeat).

`files` and `skills` split their entries by where they run: `index.ts` is client-safe and `server.ts` holds server code. Other features still export server functions from `index.ts`, so client code imports their files directly.

## Consequences

- The hand-built reducers `toolkit-permissions-machine`, `oauth-connection-machine`, `consultation-machine` and `composer-resource-machine` are deleted.
- A newer read replaces an older one through React Query's cancellation, so no hook keeps attempt tokens for reads.
- React Query does not refetch on window focus or reconnect (`refetchOnWindowFocus: false` in `app-providers.tsx`). The composer balance has its own `focus` listener, so it reads again when the person comes back from another window.
- The live browser panel still owns its poll. Moving it onto a query means merging its local states (control pending, disconnected) with each poll; that is a separate change.
