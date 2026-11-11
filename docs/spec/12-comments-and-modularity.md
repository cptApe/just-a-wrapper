# Comments and modularity

Where the reasons for the code live, what a comment may say, and where a helper goes. The [code standard](01-code-standard.md) sets the rules in brief (sections 6 and 7). This file adds the detail.

## 1. Where reasoning lives

There are three places, and each holds one kind of fact.

| Place | Holds | Example |
| --- | --- | --- |
| The code | What happens. | A guarded update that only moves a row out of `pending`. |
| A comment | The constraint the code cannot show, in the present tense. | `// Stripe delivers events out of order, so compare against the live charge.` |
| [`docs/decisions/`](../decisions/README.md) | Why we chose this over the alternatives, and what the choice makes harder. | [0015: meter from actual provider cost](../decisions/0015-meter-from-actual-provider-cost.md) |

Git history is not one of the places. The code was developed privately and published as a single commit, so `git log` and `git blame` do not explain anything that happened before publication. A reason that matters goes into a decision file, and the code links to it.

Write or update a decision when a change does any of these:

- It picks one design over another that a reasonable contributor would try first.
- It reverses or narrows an earlier decision. Mark the old file as superseded and link the new one.
- It removes something a reader will look for, such as a feature, a provider or a state.

A decision file states the context, the decision, why, and the consequences. It does not restate the code.

## 2. Comments

- **Say why, in the present tense.** A comment names a constraint, a product rule or a failure mode. A comment that restates the next line is deleted, and the code is renamed or restructured instead.
- **File headers are three lines at most.** A header says what the file is for and the one constraint a reader must know. Longer reasoning belongs in a decision file. Link to it and stop.
- **Refer to things by stable names.** Allowed: a file path, `docs/spec/<file>` with a section, a decision number, a provider documentation URL. Not allowed: dates, ticket or pull request numbers, stage numbers, people's names, and words that describe a change, such as "used to", "legacy", "no longer", "for now" or "temporary".
- **Own the comments next to your change.** If a change makes a nearby comment wrong, fixing the comment is part of the change.
- **A TODO has an owner and an action:** `TODO(<owner-or-scope>): <action>`. The repository has none today. Keep it close to that.

### Enforcement

`pnpm lint` runs these local rules:

- `no-journal-comments` rejects issue numbers, numbered stages and dates in `src/**` comments. A date is allowed next to the word `verified` or a URL, for notes that record a third-party API shape.
- `suppression-requires-reason` requires a reason in the same comment as any `eslint-disable`, `biome-ignore` or `@ts-` directive.
- `no-stray-console` keeps application code on the structured logger.
- `require-form-primitive` keeps every form on `Form` from `@/components/ui/form`.

`pnpm deadcode` runs Knip with no baseline: unused files, exports and dependencies all fail it, and `pnpm verify` runs it. The UI kit is not exempt. An export that only a unit test reaches through `loadTsx` carries a `@public` tag that says so.

## 3. Where a helper lives

1. **Used once:** it stays in the file, below the function or component that uses it.
2. **Used twice in one feature:** `features/<feature>/lib/` for pure functions, `features/<feature>/hooks/` for React hooks.
3. **Used by two or more features:** `src/lib/` for logic or `src/hooks/` for hooks, in a file named for its domain. It can also stay exported from the feature that owns the concept. `src/lib/utils.ts` holds `cn` and nothing else.
4. **Server and browser versions of one concept:** the same base name, a `-client` suffix on the browser file, and the same signature. `analytics.ts` and `analytics-client.ts` show the pattern.

Move a helper when its second caller appears, not before. Similar blocks of code follow the rule of three in code standard 1.4. Before you write a helper, look for it: the file names in `src/lib/` and the feature's `lib/` are the whole search space.
