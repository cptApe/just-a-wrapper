# Just a Wrapper

An open-source AI workspace built on Claude Managed Agents: chat, files, memory, connected apps, skills and scheduled tasks. Forks make it their own through configuration (name, address and contact details, see [decision 0048](docs/decisions/0048-brand-and-contact-come-from-configuration.md)) and the playbooks in `.claude/skills/`.

## Where things are

- [docs/spec/00-start-here.md](docs/spec/00-start-here.md) maps the specs. The [code standard](docs/spec/01-code-standard.md) is the bar for every change, and `pnpm lint` enforces most of it.
- [docs/decisions/](docs/decisions/README.md) says why the code is the way it is. Git history does not, because the repository was published as one commit. When a change picks one design over another, add or update a decision.
- Business logic lives in `src/features/<feature>/`. Routes in `src/app/` parse input, call a feature and return. The data model is `src/db/schema/`.
- [eslint-rules/feature-layers.mjs](eslint-rules/feature-layers.mjs) puts every feature in an ordered layer. A feature imports only lower layers, so read it to find where new code goes.

## What the code cannot tell you

- **Provider APIs are newer than your training data.** Claude Managed Agents is in beta and Next.js here is a recent major. Check the official documentation for any third-party call you write, and read the matching guide in `node_modules/next/dist/docs/` before changing framework code.
- **Some commands write to live services.** `pnpm db:migrate`, `pnpm seed:agents`, `pnpm seed:stripe`, `pnpm posthog:sync`, `pnpm skills:backfill` and `pnpm composio:remint` act on whatever `.env` points at. Check the target first, and get the owner's go-ahead for any account that is not a development one. `pnpm test:integration:docker` is always safe: it starts its own database and removes it.
- **A build breaks a running dev server.** Do not run `pnpm build` or `pnpm verify`, or delete `.next`, while `pnpm dev` is using the same checkout.
- **The UI is designed by hand.** Before UI work, read the [design system](docs/spec/08-design-system.md) and [modals](docs/spec/09-modals.md). Check the loading, empty, success and error states in the running app.

## How to work

- If a feature can only be bolted onto the current structure, say so and recommend the refactor before building it.
- Fix a bug with the test that fails without the fix.
- Finish with `pnpm verify`, and with `pnpm test:integration:docker` when database behaviour changed. While working, `pnpm exec eslint <paths>` and `pnpm typecheck:fast` give the same answers faster.
