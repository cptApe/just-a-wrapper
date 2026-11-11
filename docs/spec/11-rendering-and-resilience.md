# Rendering and resilience

A render error never shows a blank page, an unknown URL never dead-ends, and the UI stays fast as data grows. Component patterns are in [03-patterns.md section 14](03-patterns.md#14-react-component-patterns). For framework behaviour, read the Next.js guides in `node_modules/next/dist/docs/` (error handling, loading UI, hydration).

---

## 1. The resilience floor

Each Next.js convention file below must exist ([Next.js error handling](https://nextjs.org/docs/app/getting-started/error-handling)).

| File | Rule |
|---|---|
| `src/app/global-error.tsx` | Replaces the root layout on a crash. It renders its own `<html>` and `<body>`, imports nothing but the client `captureException`, and offers retry and a link home. |
| `src/app/not-found.tsx` | Says the page does not exist and links home. Applies to every `notFound()` without a closer `not-found.tsx`. |
| `src/app/app/(shell)/task/[id]/not-found.tsx` | The task loader calls `notFound()` for an unknown task or one the caller cannot see. The copy says so and links back to the app. |
| `error.tsx` | Exists at `src/app/app`, `app/(shell)`, `app/settings`, `app/(shell)/task/[id]`, `(auth)` and `(admin)`. Each is a client component that calls `captureException` in an effect and renders the shared `ErrorState` (`src/components/layouts/error-state.tsx`) with `unstable_retry`. A deeper segment adds its own only when it has an independent data path. |
| `loading.tsx` or a `<Boundary>` skeleton | Every page with an async server component has one, so it never flashes blank. |

`src/app/app/error.tsx` catches a failed read in the `(shell)` and `settings` layouts, which their own `error.tsx` cannot catch. It never redirects, because a failed read says nothing about whether the person is signed in.

Public share links (`src/app/share/[token]/page.tsx`) render their own expired, revoked and unknown states in place instead of calling `notFound()`.

Inside a page, `<Boundary>` (`src/components/layouts/boundary.tsx`) pairs Suspense with an error boundary. Each async island gets one, with a skeleton shaped like its content. `error.tsx` catches what escapes.

## 2. Render-performance rules

- **Server components by default; `'use client'` at the leaf.** No client pages, no client layouts.
- **No component definitions inside components.** A nested definition remounts its subtree on every render.
- **A context provider's `value` is memoized or a primitive.**
- **No `React.memo` or `useMemo` by reflex.** Profile first ([code standard 5.7](01-code-standard.md#5-react)).
- **`next/image` by default.** A raw `<img>` needs an `@next/next/no-img-element` suppression with its reason, which `just-a-wrapper/suppression-requires-reason` requires. Authenticated byte routes and durable CDN uploads are the accepted reasons.
- **`key={index}` only for skeletons and `aria-hidden` placeholders.** Real content keys on a stable id.
- **Heavy client dependencies load behind `next/dynamic` or `lazy()`** when first paint does not need them. `pdfjs-dist` loads through `next/dynamic` in `src/features/files/components/file-preview.tsx` and `src/features/files/components/artifact-viewer.tsx`. Recharts loads through `lazy()` in the chart loaders. `streamdown` and `katex` stay static because they render the chat's first paint.
- **`streamdown` does not declare its Shiki dependency.** The `pnpm.packageExtensions` entry in `package.json` adds it so resolution is deterministic. Remove the entry when upstream declares it.
- **Lists are bounded, not virtualized.** Files, notifications and memory page with load-more. Virtualize only when one bounded view must exceed about 200 rows. The chat thread (`src/features/chat/components/chat-thread.tsx`) renders every turn; if long sessions slow down, add a window of rendered turns with "show earlier", not a virtualization library.
- **No fetch in an effect.** Page reads are server components under `<Boundary>`; client reads are React Query ([03-patterns.md section 2](03-patterns.md#2-react-query)). `fetchJson` is the transport inside those patterns, not a reason for an effect.
- **`suppressHydrationWarning` only on nodes that differ on the client by design:** the theme root in `src/app/layout.tsx` and the live dates in `src/features/scheduled/components/`. Never use it to silence a real mismatch.

## 3. Four states

Every data view renders loading, empty, success and error ([code standard 5.5](01-code-standard.md#5-react)). The layer that owns a fetch renders its four states. A pane that fetches on the client after the page has loaded owns its own error state; the page `<Boundary>` does not cover it.

| Failure | Surface |
|---|---|
| A one-off action fails | Toast |
| A field is invalid | Inline next to the field |
| A load fails | Error state in place, with retry |

A toast is a notification, not an error state. An inline error reserves its space so nothing jumps.

## 4. Chat delivery and recovery

| Concern | Rule | Owner |
|---|---|---|
| Stream connection | One reducer owns attach attempts, replay, terminal access loss and bounded retry. A received frame resets the backoff. | `src/features/chat/lib/connection-machine.ts` |
| Workspace status | Workspace status events can enter or leave a credit pause or end a task. They cannot overwrite any other live status, such as a tool-dispatch stop reason. A terminated task never moves. | `moveChatStatus` in `src/features/chat/lib/chat-status-machine.ts` |
| Message sends | A send keeps one client UUID across retries. Delivered claims are terminal. Only a connection failure or a provider 5xx leaves a claim unconfirmed. | `src/features/sessions/api/session-send-transitions.ts` |
| Send recovery | A claim holds a lease that the sender renews before each post; recovery takes over only a lapsed lease. Retry reads tagged provider history. After the confirmation window, a history miss allows a guarded reclaim and one new post. The sidebar sweep resolves abandoned claims the same way. | `src/features/sessions/api/session-send-transitions.ts` |
| Send retention | Claims store a SHA-256 hash of the content, not the text. New claims prune delivered rows older than `SESSION_SEND_RETENTION_MS`; active and retryable rows stay. | `src/features/sessions/api/session-send-transitions.ts` |
| Pending activity | Compares server status timestamps, never the browser clock. | `src/features/chat/hooks/use-pending-sends.ts` |
| Custom-tool dispatch | Execution progress and delivery failures are separate states. Progress polls keep a fixed server-lease deadline. Delivery failures end in an exhausted state that offers Retry. | `src/features/chat/lib/tool-request-machine.ts` |

Deferred Home openings and sends from the loading composer carry the same UUID through the POST and the handoff to the task view. A failed send puts the whole draft back (text, files, Library files, folders and skills) through one function, `restoreComposerDraft` in `src/features/chat/lib/draft-store.ts`, whether or not a composer is open; the next composer on that draft shows it ([decision 0041](../decisions/0041-one-composer-draft.md)).
