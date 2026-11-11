# Code standard

This is the quality bar for every line in this repo. It is opinionated on purpose: one way to do each thing, written down, checked by tools where a tool can check it. Architecture lives in [02-foundation.md](02-foundation.md); folder shape and framework recipes live in [03-patterns.md](03-patterns.md). When this file and another doc disagree, this file wins and the other doc gets fixed.

Sources for each rule are listed at the end. The short version: deep modules, one path per capability, fail loudly, parse at the edge, delete what nobody needs.

## 1. Design

1. **One way to do each thing.** Before writing a helper, a fetch, a route, a date format or an error mapping, find the existing one and use it. Two patterns for one problem is a bug in the codebase, even when both work.
2. **Deep modules.** A module earns its place by hiding real work behind a small interface. A function that only forwards its arguments to another function is deleted and its callers call the real one.
3. **No speculative generality.** No parameter, option, flag, env var, interface or branch that no current caller needs. Build for the caller you have.
4. **Abstract on the third case.** Two similar blocks stay duplicated. The third occurrence gets one shared helper in the right home (section 6). An abstraction that turned out wrong is inlined back into its callers.
5. **Adapters only with two real implementations.** An interface, `*Deps` type or `*-core.ts` split that exists for one implementation is removed. Tests reach external services through the integration stack or one narrow seam at the network edge, never by threading fakes through business code.
6. **Delete dead code.** Unused exports, files, scripts, flags, compat shims and "legacy" branches are deleted. If a reader will look for what was removed, a [decision file](../decisions/README.md) says why it went. `pnpm verify` runs Knip over unused files, exports and dependencies, the UI kit included.
7. **Small, single-purpose units.** A function does one thing and reads top to bottom. Guide sizes: functions under 60 lines, components under 150, files under 400. Past those numbers, split by concern, never by arbitrary line count.

## 2. Configuration and providers

1. **Decide once, at startup.** Every optional capability (web search, browser, email, analytics, billing, connected apps) is resolved once from the validated env into `src/lib/capabilities.ts`. Code asks the capability (`capabilities.webSearch.kind === 'exa'`) and runs exactly one path.
2. **No runtime cascades.** Never "try provider A, then B, then log". Never `a ?? b ?? c ?? default` across sources of truth. If a value can come from two places, one place is the source and the other is deleted.
3. **Missing configuration is explicit.** A capability that is off is a typed `{ kind: 'off' }` value. The UI keeps the feature visible and says, in one sentence from `src/lib/capability-messages.ts`, why it is off and which setting turns it on. The agent is not offered tools that are off, and its prompt says why. A capability that is on but broken throws.
4. **Env is read in one module.** Only `src/lib/env.ts` reads configuration from `process.env`. A few platform keys (`NODE_ENV`, `NEXT_RUNTIME`, `VERCEL_ENV`, the inlined `NEXT_PUBLIC_*` keys) are read directly; `just-a-wrapper/no-raw-env-read` lists them. Constants that never vary per deploy stay constants, not env vars.

## 3. Errors

1. **Throw typed errors.** Every throw in `src/` is an `AppError` subclass from `src/lib/errors.ts` with a stable `code`, structured `context` and the native `cause`.
2. **Catch only to do something.** A `catch` is allowed in exactly three cases: (a) a boundary that turns the error into a response or UI state (`withApiRoute`, error boundaries, form actions), (b) translating a foreign error into an `AppError` and rethrowing, (c) a real recovery whose reason is a named product rule (for example "a deleted Anthropic session means the chat is archived"). Catch-and-return-a-default, catch-and-continue and catch-capture-and-carry-on are banned.
3. **Log or rethrow, never both.** The boundary that handles an error reports it. Code in the middle adds context and rethrows.
4. **Define errors away.** Make operations idempotent where the meaning allows (deleting a missing row succeeds, an empty list is an empty list) instead of inventing an error path.
5. **Messages carry facts.** An error message names what failed and the identifiers involved. "Something went wrong" is never written.
6. **Expected outcomes are values, defects are throws.** A mutation called from a form or button returns its typed `ActionState` union through `runAction`. Everything else throws. `{ ok: false }` result objects exist only as `ActionState`.

## 4. Types

1. **Parse at the boundary.** Request bodies, webhook payloads, provider responses, JSON columns, `localStorage` and URL params are parsed once with Zod where they enter. Inside the app, trust the types.
2. **No re-checking guaranteed values.** No `?.`, `?? ''`, `typeof x === 'string'` or `if (x)` on a value whose type already guarantees it. `@typescript-eslint/no-unnecessary-condition` enforces this.
3. **No escape hatches.** No `any`, no `as unknown as`, no non-null `!`, no `@ts-ignore` or `@ts-expect-error`. An `as` cast is allowed only for a `const` assertion or a branded type constructor. If the types do not fit, the model is wrong; fix the model.
4. **Model states as unions.** Use discriminated unions, not bags of optional fields or parallel booleans. Every `switch` over a union is exhaustive.
5. **Derive types.** Types come from Zod schemas (`z.infer`), Drizzle tables (`$inferSelect`) and SDK exports. Never hand-copy a shape that already has a source.
6. **Indexed access is checked.** `noUncheckedIndexedAccess` is on. Handle the missing case where it can happen; restructure the data where it cannot.

## 5. React

1. **Derive, do not sync.** A value computable from props or state is computed during render. A `useEffect` whose body only calls a setter is deleted.
2. **Events in handlers.** Code that runs because the user did something lives in the event handler, not in an effect watching state.
3. **Server data lives in React Query.** Never copy query data into `useState`. Each feature owns its key factory in `api/keys.ts`, and every key roots on the organization id, named `organizationId`. Mutations invalidate through the factory. An effect never calls `fetch`, `fetchJson` or a server action; `just-a-wrapper/no-effect-fetch` enforces it ([decision 0044](../decisions/0044-one-way-to-load-and-change-server-data.md)).
4. **Client stores use `useSyncExternalStore`.** No state library. A store lives in the feature's `lib/` with its hook in `hooks/`.
5. **Four states.** Every data-driven view renders loading (a skeleton shaped like the content), empty, success and error.
6. **Hooks live in `hooks/`.** A hook is named for its intent (`use-task-list`) and returns a small object. A hook returning more than five values is split.
7. **Memo for a reason.** `useMemo` and `useCallback` only where a measured cost or a referential dependency needs them.
8. **One way to build a form.** Every edit-and-commit surface is `Form` from `@/components/ui/form` with a `type="submit"` Save, so Cmd+Enter saves it. `just-a-wrapper/require-form-primitive` enforces this; see [patterns](03-patterns.md#forms-the-one-way-to-build-one).

## 6. Files and modules

1. **Feature shape.** `src/features/<feature>/` holds `components/`, `hooks/`, `api/` (server code and React Query hooks), `lib/` (pure functions and stores), `types.ts`, `constants.ts`, `index.ts`. The folder tree tells a new reader what the app does.
2. **Three import boundaries, each a lint rule.** See [decision 0027](../decisions/0027-enforced-feature-boundaries.md) and [decision 0040](../decisions/0040-layered-features.md).
   - **API routes use a feature's entries.** A route imports a feature through its `index.ts` (client-safe components, keys and types) or `server.ts` (`server-only` re-exports of server functions). `just-a-wrapper/no-deep-feature-import` enforces this. A feature may add a client entry, such as `@/features/files/browser`, when client code must not load its server barrel. Features have no other barrel files.
   - **Shared layers never import features.** Nothing in `src/lib`, `src/hooks`, `src/components` or `src/db` imports `@/features/...`. Code that needs a feature moves into that feature, and a UI primitive takes feature behaviour as a prop. `just-a-wrapper/no-shared-feature-import` enforces this. `src/lib/auth.ts` is the one exemption, because Better Auth takes its billing, notification and workspace hooks in one config object.
   - **Features sit in ordered layers.** Every folder in `src/features` has one place in the table in [`eslint-rules/feature-layers.mjs`](../../eslint-rules/feature-layers.mjs): platform, kernel, library, runtime, capabilities, product, chrome. A feature imports a feature in a lower layer, or one listed before it in its own layer, and nothing else. `just-a-wrapper/no-upward-feature-import` enforces this, so two features never import each other and no cycle can form. When code needs something from a higher feature, move the shared piece down (to the lower feature, `src/lib` or `src/components`) or take the behaviour as a parameter or prop from a caller that sits above both. A new feature gets a row in the table in the same diff; a unit test fails until it does. `pnpm layers` prints the edges, the same-layer edges and any cycle. Pages, layouts and features may import any file of a feature they are allowed to reach.
3. **Shared code has one home.** Used by two or more features: `src/lib/` (logic) or `src/components/` (UI). `src/components/ui/` holds the primitives; the kits that several features build their screens from live beside it: `src/components/settings/` (settings rows and sections), `src/components/admin/` (admin sections, rows and agent buttons) and `src/components/layouts/` (nav item classes, the mobile nav button). A UI kit never lives inside a feature that other features import it from. Every value a person reads (dates, clocks, relative times, durations, sizes, counts, money, percentages, plurals) is formatted by `src/lib/format/`, in `en-US`, with the reader's zone and time format passed in from `getDisplayPreferences` on the server or `useDisplayFormat()` in the browser ([decision 0043](../decisions/0043-one-way-to-format-values.md)). `just-a-wrapper/no-raw-intl-format` enforces it. No `utils.ts` or `helpers.ts` grab bags.
4. **Named exports.** Default exports only where Next.js requires them (pages, layouts, route segment files).
5. **Routes do nothing.** Every API route handler uses `withApiRoute` from `src/lib/route-kit.ts`: parse input, call the feature's `api/`, return. One error response shape: `{ error: { code, message } }`.
6. **Kebab-case files named for their export.** `chat-header.tsx` exports `ChatHeader`.
7. **One way to write an import path.** In `src/`, an import that leaves the file's feature (or its top-level folder, such as `src/lib`) uses `@/`. An import inside it may be relative. No import names a `.ts` or `.tsx` suffix. `just-a-wrapper/import-style` enforces this and fixes it. Every Node entry point (`pnpm test:unit` and every script) loads `scripts/register-aliases.mjs`, which resolves `@/`, `@content/` and paths without a suffix. Scripts and tests sit outside `src/` and may reach into it by relative path.

## 7. Naming and comments

1. **Full words.** No `data`, `info`, `res`, `req`, `msg`, `cfg`, `opts`, `tmp`, `val`, `obj`, `item2`. No `Manager`, `Processor`, `Helper`, `Handler` suffixes on things that are not event handlers. Name what the value is (`unreadCount`, `sessionRow`).
2. **Booleans read as questions.** `isPrivate`, `hasCredits`, `canShare`.
3. **No positional booleans.** A function taking a flag takes a named options object or a union instead.
4. **Comments say why.** A comment names a constraint, a product rule or a failure mode the code cannot show. A comment that restates the next line is deleted. File headers are three lines at most. No section banners, no `@param` that repeats the signature.
5. **Comments state the present.** No dates, ticket numbers, people's names, "used to", "legacy", "no longer", "for now" or "temporary". `just-a-wrapper/no-journal-comments` catches dates, issue and stage numbers, process words and "the old"; review catches the rest.

## 8. Tests

The suite stays small enough to read. Every test earns its run time.

1. **A test names a failure someone would notice.** It exists only if it catches a wrong charge, a data leak or wrong access, lost or duplicated data, or a broken flow. The test name says that failure in plain words.
2. **Keep and strengthen:** money (charges, the ledger, Stripe webhooks, limits), access and privacy, session and schedule integrity, migrations against real Postgres, the custom lint rules.
3. **Do not write:** tests of markup, class names, copy strings, icon choice or prop passing, tests of what the type checker or lint already guarantees, or a second test of the same behaviour.
4. **One test file per behaviour area**, tested through the feature's public interface. A bug fix adds a case to the existing file, never a new file. A refactor that keeps behaviour should not touch tests.
5. **Prefer one integration test on the real database over many unit tests with fakes.** Never mock the unit under test. An integration test imports `db` from `@/db` and never mocks it.
6. **A bug fix comes with the case that would have caught it.**
7. **Mock only the outside.** An integration test replaces provider clients and telemetry, plus configuration and the signed-in session through `tests/integration/helpers/seams.ts`. Every app module runs for real on seeded rows. Lint enforces the list ([decision 0012](../decisions/0012-integration-tests-on-real-postgres.md)).
8. **No source text.** A test calls the code, renders it, or lints a sample. It never matches text in a `src/` file. A rule over the whole tree is a lint rule; a rule about one value is a type.
9. **A stub is for an import the code makes.** A loader stub for a specifier nothing imports is dead and goes.

## 9. Enforcement

- `pnpm lint` runs ESLint with type-aware typescript-eslint rules (`no-unnecessary-condition`, `switch-exhaustiveness-check`, `no-floating-promises`, `no-non-null-assertion`, `no-unnecessary-type-assertion`) plus the `just-a-wrapper/*` rules.
- `import-style` holds section 6.7. The import boundaries in section 6.2 are three more rules: `no-deep-feature-import` on `src/app/api`, `no-shared-feature-import` on the shared layers and `no-upward-feature-import` on `src/features`. A diff to `eslint-rules/feature-layers.mjs` is reviewed as an architecture change.
- The lint cache key includes a digest of `eslint-rules/`, so a change to a rule or to its data file re-lints every file.
- `pnpm typecheck` runs with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch`.
- Targeted checks use `pnpm exec eslint <paths>` and `pnpm typecheck:fast`; they enforce the same rules as the full checks.
- Review uses the checklist below on every diff.

### Review checklist

1. Two or more `??` or `||` defaults on one expression.
2. A `catch` that returns a default, continues, or only logs.
3. `as`, `!`, `any`, `@ts-expect-error`.
4. `?.` or a `typeof` check on a typed value.
5. A wrapper that only forwards, an interface with one implementation, a `*Deps` parameter.
6. A second way to do something the repo already does (fetch, route, format, error shape).
7. A `useEffect` that sets state derived from props or state.
8. A comment that narrates code, a banner, or a dated or "legacy" note.
9. Vague names (`data`, `result`, `handleThing`, `*Manager`).
10. A file over 400 lines or a function over 60 without a reason.
11. An option, flag or env var with one value in practice.
12. A test that mocks the code it claims to test, or matches text in a source file.
13. A lifecycle held in loose flags, nullable fields, `useRef` guards or a status write outside its transition module (section 10).

## 10. State machines

Anything with a lifecycle is a state machine and is written as one. Do not encode a lifecycle in loose flags, nullable fields, refs or scattered status writes.

**Persisted state.** Each lifecycle has one table of allowed moves, built with `defineStateMachine` from `src/lib/state-machine.ts`, in the owning feature's `lib/<name>-machine.ts`.

- One module, `api/<name>-transitions.ts`, performs every write. No other code sets that status. `just-a-wrapper/no-machine-status-write` checks Drizzle updates, explicit insert states, and conflict updates against the table/column owners in `eslint-rules/no-machine-status-write.mjs`. The map also covers lifecycle timestamps and leases (`deletedAt`, `revokedAt`, `hiddenAt`, `*ClaimedAt`, budget sync lease); an insert default may set one where the map allows it. Add every new persisted lifecycle column to that map: a unit test fails when a `defineStateMachine` has no declared column or owner. Tests and migrations are exempt.
- Every write is a guarded update: `where status in machine.sourcesOf(to)`. It returns whether the row moved, and the caller handles a lost race by name.
- A terminal state has no moves out. Replays and late events cannot leave it.
- Fields that travel with a state move in the same update. Do not store one fact twice. If a value can be derived from the status, derive it.
- Multi-table pairs that must stay consistent get a database `CHECK`. Value lists always do.
- Webhook handlers never trust delivery order. They move a machine only through its table, and they compare against provider state when order matters.

**Claim, act, finalize.** A step that claims a row and then calls a provider has a named in-between state and a named way out of it, for a crash as well as for a failure. No claimed row may be stuck forever: a sweep, a retry or a read path must finish it. Do not run provider calls inside a database transaction that holds a row lock.

- **A lease is a token and a deadline.** The claim writes a fresh owner token and a deadline on the database clock. Every later write compares the token, so a worker that lost its lease cannot settle the row, and a sweep takes over only after the deadline (`session_send.attempt_token` and `recover_after`, [decision 0034](../decisions/0034-send-leases-and-turn-starts.md)).
- **Time comes from the database.** A decision that compares times reads `now()` from Postgres once and uses that value, never the app clock (`lockLedger` puts it on `ledger.now`, [decision 0032](../decisions/0032-one-ledger-clock-and-explicit-payment-records.md)).
- **Our row first, then the provider.** A command writes the row and a durable mark of what the provider still owes in one statement; a pusher under a lease settles the mark, and a sweep finishes a mark a crash left behind. A version column, not `updated_at`, tells two edits apart (`task.version` and `task.provider_sync`, [decision 0035](../decisions/0035-tasks-are-the-truth-and-providers-follow.md)).

**Client state.** A lifecycle in the browser is a discriminated union driven by one pure reducer in `lib/`, tested without React.

- No clusters of related `useState` booleans, and no `useRef` flags that act as state. A ref may hold a browser handle, a timer or an attempt token.
- Async work carries an attempt token or an `AbortSignal`, so a stale response cannot move the state. One request at a time from a button or form uses `useAsyncAction` in `src/hooks/use-async-action.ts`.
- A derived value stays derived. Do not copy it into state.

**What does not need a machine.** One independent toggle, such as a menu's open flag, and plain loading from one library hook.

**Tests.** The table has a unit test for allowed and refused moves. Each guarded write has an integration test proving that a stale or terminal row does not move.

## Sources

John Ousterhout, *A Philosophy of Software Design* (deep modules, define errors out of existence). Sandi Metz, "The Wrong Abstraction". Kent C. Dodds, "AHA Programming", "Colocation", "Write tests". Rich Hickey, "Simple Made Easy". Alexis King, "Parse, don't validate". James Shore, "Fail Fast". Google TypeScript Style Guide. Total TypeScript on discriminated unions and `noUncheckedIndexedAccess`. React docs, "You Might Not Need an Effect". TkDodo, "Practical React Query". Next.js data security guide (one data access layer, one env reader). Vercel AI SDK contributing guide (rule of three for provider abstractions, no ad-hoc abbreviations). tldraw and cal.com agent guides (comments name failure modes; no restating comments). Anthropic prompting guide on overeager code (no fallbacks for scenarios that cannot happen).
