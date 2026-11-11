# Start here

**Just a Wrapper** (`just-a-wrapper`; each deployment sets its own display name) is a multi-tenant AI workspace on Claude Managed Agents. It gives people who run their own business chat that does real work, connected apps, files, memory, skills and scheduled tasks. Forks replace the brand values in `content/brand.ts`.

## Where each answer lives

| Question | Source |
| --- | --- |
| What does the app do today? | The shipped code. Accepted requirements define changes. |
| What rules does code follow, and how is it built? | This folder. |
| Why is it built this way? | [The decisions folder](../decisions/README.md). Git history is not a source, because the repository was published as one commit. |
| How do I set it up or deploy it? | [README.md](../../README.md) and [docs/deploy.md](../deploy.md). Operator commands are in [docs/operations.md](../operations.md). |

These docs never restate what the code already carries. They hold constraints from outside the repo, invariants and where each is enforced, product rules, and the order of files in flows that span many of them.

## Doc map

Listed in reading order.

| File | Owns | Open when |
| --- | --- | --- |
| [01-code-standard.md](01-code-standard.md) | The quality bar: design, configuration, errors, types, React, files and modules, naming, tests, enforcement, state machines | Before writing or reviewing any code |
| [12-comments-and-modularity.md](12-comments-and-modularity.md) | Where reasoning lives, comment rules, where a helper lives | Documenting non-obvious code or moving a module |
| [02-foundation.md](02-foundation.md) | Architecture: Anthropic primitives, the MCP proxy, memory, tooling, files, notifications, real-time state, billing (including the list of paid entry points), the boundary with providers, code layout, the fork model, environment separation, key flows | Before designing anything |
| [03-patterns.md](03-patterns.md) | Code conventions: feature folder shape, React Query, route groups and the auth guard, environment validation, client state, API clients, the custom-tool contract, naming, instrumentation, component patterns, project skills, linting and CI | Before writing code |
| [03b-configuration-map.md](03b-configuration-map.md) | Which file holds each operator setting: brand, theme, pricing, connected apps, skills, tiers, environment | Changing a value an operator configures |
| [04-observability.md](04-observability.md) | `AppError` types, request context, no silent failures, trace IDs, logs, replay, error messages an agent can read | Wiring instrumentation or handling an error |
| [13-privacy.md](13-privacy.md) | Who can do what: the table of who can read and write each resource, and the function that enforces each rule | Changing access to anything a member owns or shares |
| [11-rendering-and-resilience.md](11-rendering-and-resilience.md) | Rendering boundaries, render performance, the four UI states, chat delivery and recovery | Changing loading, error or streaming behaviour |
| [08-design-system.md](08-design-system.md) | The design language: tokens, colour, typography slots, geometry, components, motion, content | Any UI work, before touching code |
| [09-modals.md](09-modals.md) | The one modal component family: geometry, presentations, API, variants | Building or changing any overlay |
| [10-analytics-events.md](10-analytics-events.md) | Analytics event names, properties, identity and ownership | Adding or changing product analytics |

New contributors read 01, 02 and 03 first. UI work adds 08 and 09.
