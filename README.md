<div align="center">

<img src="src/app/icon.svg" alt="Just a Wrapper logo" width="72" height="72">

# Just a Wrapper

**An open-source, self-hosted AI workspace for teams, built on Claude Managed Agents.**<br>
Chat, files, memory, connected apps, skills and scheduled tasks in one Next.js app you can fork and ship as your own product.

[Live demo](https://wrapper.arnas.st) · [Docs](docs/spec/00-start-here.md) · [Deploy](docs/deploy.md) · [Changelog](CHANGELOG.md) · [Report a bug](https://github.com/cptApe/just-a-wrapper/issues/new?template=bug_report.yml)

[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![CI](https://github.com/cptApe/just-a-wrapper/actions/workflows/ci.yml/badge.svg)](https://github.com/cptApe/just-a-wrapper/actions/workflows/ci.yml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![Built on Claude Managed Agents](https://img.shields.io/badge/built%20on-Claude%20Managed%20Agents-black)](https://platform.claude.com/docs/en/managed-agents/overview)

</div>

<p align="center"><img src="public/social/readme-hero.png" alt="Just a Wrapper: an agent chat with the task list, a result table and the composer" width="100%"></p>

## What is Just a Wrapper?

Just a Wrapper is an open-source alternative to ChatGPT and Claude.ai for teams. It gives your users a complete AI workspace: chat with agents that do real work, a shared file library, memory, reusable skills, connected apps such as Gmail, Google Drive, Notion and HubSpot, and tasks that run on a schedule.

Every AI product ends up rebuilding the same interface. The value of your product is in the prompts, the data and the logic, not in the chat window, the file browser or the billing screens. This repository is that interface, already built, so you can spend your time on the part that is yours.

It runs on [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview), Anthropic's hosted agent runtime. Anthropic runs the agent loop, the sandboxed containers, memory stores, skills and scheduled runs. This app adds accounts, workspaces, files, permissions, connected apps, billing and the interface on top.

**Who it is for**

- Developers who want to launch a vertical AI product (a legal assistant, a research tool, an agency copilot) without building the workspace from scratch.
- Teams who want a self-hosted AI workspace on their own Anthropic account and database.
- Anyone learning how to build a production app on Claude Managed Agents.

## Features

**Chat and agents**

- Chat with agents that stream their work step by step and keep their sessions.
- Three model tiers: Fast (Claude Haiku), Balanced (Claude Sonnet) and Expert (Claude Opus).
- Send a follow-up while the agent is still working; it joins the platform queue.
- Search across past conversations.
- Thumbs up and down feedback on answers.

**Files, memory and skills**

- A file library with private uploads and previews for PDF, Word, Excel, PowerPoint, images and video.
- Share links for files, checked on every use.
- Memory that carries across chats, backed by Managed Agents memory stores.
- Bundled skills, plus skills your users write or the agent saves for them.

**Tools**

- Connected apps through [Composio](https://composio.dev), with one shared account per app or a personal one per member.
- Web search and page reading through [Exa](https://exa.ai), or Anthropic's built-in web tools when Exa is off.
- A cloud browser through [Browserbase](https://www.browserbase.com) that the agent can drive.
- Image generation and editing, video generation, voice input and read-aloud, and charts.

**Teams and work**

- Workspaces with members, roles and email invitations.
- Private by default: chats and files stay with their owner until shared, with one Team folder for shared work.
- Scheduled tasks that run on Anthropic's scheduler, with in-app and email notifications and daily digests.
- Sign in with an email code or Google.

**Running it as a product**

- Billing on [Stripe](https://stripe.com): monthly plans chosen, changed and cancelled in the app, one-time credit top-ups, saved cards, auto top-up and the customer portal. Or credits only, with no plans.
- Usage metered from the cost each provider actually reports, with one margin setting that sets every price.
- An operator console at `/admin` that shows how your fork is configured (off by default).
- Optional product analytics and session replay through [PostHog](https://posthog.com).
- Light and dark themes and a layout designed for phones.

Every optional provider is resolved once at startup. Leave its keys out and the app runs without it, with the control visible and a note on how to turn it on.

## Built with

| Layer | Technology |
| --- | --- |
| Agent runtime | [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) through the [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) |
| Framework | [Next.js 16](https://nextjs.org) (App Router) and [React 19](https://react.dev) |
| Styling and UI | [Tailwind CSS 4](https://tailwindcss.com), [Radix UI](https://www.radix-ui.com), [shadcn/ui](https://ui.shadcn.com), [Streamdown](https://github.com/vercel/streamdown) for streamed Markdown |
| Data fetching | [TanStack Query](https://tanstack.com/query), [nuqs](https://nuqs.dev) for URL state |
| Database | [PostgreSQL](https://www.postgresql.org) on [Neon](https://neon.tech), with [Drizzle ORM](https://orm.drizzle.team) |
| Auth | [Better Auth](https://www.better-auth.com) with organizations, email codes and Google |
| Connected apps | [Composio](https://composio.dev) Tool Router behind an [MCP](https://modelcontextprotocol.io) proxy |
| Billing | [Stripe](https://stripe.com) |
| Email | [Resend](https://resend.com) |
| Files | [Vercel Blob](https://vercel.com/docs/vercel-blob) |
| Media and voice | [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) and the [AI SDK](https://ai-sdk.dev) |
| Web search and browser | [Exa](https://exa.ai), [Browserbase](https://www.browserbase.com) with [Stagehand](https://www.stagehand.dev) |
| Analytics | [PostHog](https://posthog.com) |
| Validation and logs | [Zod](https://zod.dev), [Pino](https://getpino.io), [OpenTelemetry](https://opentelemetry.io) |
| Hosting | [Vercel](https://vercel.com) |
| Tooling | [pnpm](https://pnpm.io), [TypeScript](https://www.typescriptlang.org), [ESLint](https://eslint.org), [Biome](https://biomejs.dev), [Knip](https://knip.dev), [Vitest](https://vitest.dev), [Playwright](https://playwright.dev) |

## Architecture

```mermaid
flowchart LR
  Browser["Browser"] <-->|"HTTPS and SSE"| App["Next.js app on Vercel"]
  App <-->|"Drizzle"| DB[("Postgres on Neon")]
  App <-->|"Sessions and events"| MA["Claude Managed Agents"]
  MA -->|"MCP tool calls"| Proxy["MCP proxy in the app"]
  Proxy --> Composio["Composio"]
  Composio --> Apps["Gmail, Google Drive, Notion and more"]
  App <-->|"Checkout and webhooks"| Stripe["Stripe"]
  MA -.->|"Scheduled run webhooks"| App
```

1. The browser talks only to the Next.js app. Chat streams over server-sent events, and one shared connection carries sidebar state, credits and notifications.
2. The app keeps workspaces, members, files, credits and live events in Postgres.
3. Claude Managed Agents runs the agents, their containers, memory stores, skills and scheduled runs. Agent records are shared per tier, and per-member details travel in vaults and session resources.
4. Every connected-app call goes through the app's own MCP proxy, which checks a signed per-member token before forwarding to Composio.
5. Stripe webhooks grant credits. The app bills each turn from the cost the provider reports.

Read [the architecture spec](docs/spec/02-foundation.md) for the full picture and [the decisions folder](docs/decisions/README.md) for why it is built this way.

## Quick start

You need:

- [Node.js](https://nodejs.org) 22.9 or newer and [pnpm](https://pnpm.io) 10.
- A Postgres database: a free [Neon](https://neon.tech) database, or Docker for a local one.
- A [Claude API key](https://platform.claude.com/settings/keys). Managed Agents is in beta and on by default for every API account.

```sh
git clone https://github.com/cptApe/just-a-wrapper.git
cd just-a-wrapper
pnpm install
pnpm run setup
pnpm dev
```

No Neon account? Run Postgres locally with Docker:

```sh
docker compose -f docker-compose.dev.yml up -d
```

Then add these two lines to `.env` before `pnpm run setup`:

```sh
DATABASE_URL=postgres://dev:dev@localhost:55434/agentcore
DATABASE_WS_PROXY=localhost:54446/v1
```

`DATABASE_WS_PROXY` is for local use only. It turns database TLS off, so production refuses it.

`pnpm run setup` asks for the database URL and the API key. It writes `.env`, applies the database migrations and creates your agents on your Anthropic account. It is safe to run again. Use `pnpm run setup`, not `pnpm setup`, which is a different command built into pnpm.

Open the address `pnpm dev` prints and sign in with your email. Locally, the six-digit code appears in the `pnpm dev` log, so you need no email service.

What works without extra keys, and what to add next:

| To turn on | Set |
| --- | --- |
| File uploads | `BLOB_READ_WRITE_TOKEN` |
| Connected apps | `COMPOSIO_API_KEY`, `MCP_PROXY_URL`, `MCP_PROXY_JWT_SECRET` |
| Billing and credits | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (billing is off without them, with no limits). `BILLING_MODE` is `subscriptions` (default) or `credits_only` |
| Image, video and voice | `AI_GATEWAY_API_KEY` |
| Exa search, cloud browser | `EXA_API_KEY`, `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` |
| Instant scheduled-run results | `ANTHROPIC_WEBHOOK_SECRET` |

Every setting, with a one-line explanation, is in [`.env.example`](.env.example). After any configuration change, run `pnpm validate:config`.

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FcptApe%2Fjust-a-wrapper&project-name=just-a-wrapper&repository-name=just-a-wrapper&env=DATABASE_URL,BETTER_AUTH_SECRET,NEXT_PUBLIC_APP_URL,NEXT_PUBLIC_BRAND_NAME,SUPPORT_EMAIL,ANTHROPIC_API_KEY,BLOB_READ_WRITE_TOKEN,RESEND_API_KEY,EMAIL_FROM)

The button creates the Vercel project and asks for the core keys, including your product name (`NEXT_PUBLIC_BRAND_NAME`) and support address (`SUPPORT_EMAIL`): the repository ships placeholders for both, and a production build refuses them. A hosted deployment needs Resend or Google sign-in, or nobody can sign in. To use only Google, import the repository into Vercel yourself and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Before you serve users, follow [docs/deploy.md](docs/deploy.md). It covers database migrations (`pnpm db:migrate`), seeding agents (`pnpm seed:agents`), provider webhooks, Stripe setup and the scheduled jobs in `vercel.json`. Use separate databases and agents for preview and production. Operator commands are listed in [docs/operations.md](docs/operations.md).

The app is a standard Next.js server, so other Node hosts work too. They need their own scheduler for the cron routes.

## Make it yours

Open [Claude Code](https://claude.com/claude-code) in the repository and say something like "turn this into a legal assistant called Lexi". The [make-it-yours](.claude/skills/make-it-yours/SKILL.md) skill changes the brand, the agent's role and voice, the theme, the bundled skills and the pricing, one step at a time. Each step has its own playbook in [`.claude/skills/`](.claude/skills):

| Skill | What it changes |
| --- | --- |
| [customize-brand](.claude/skills/customize-brand/SKILL.md) | Name, web address, support email, slug and logo |
| [customize-theme](.claude/skills/customize-theme/SKILL.md) | Colors, radii and type in light and dark mode |
| [customize-skills-pack](.claude/skills/customize-skills-pack/SKILL.md) | The skills every new workspace starts with |
| [customize-pricing](.claude/skills/customize-pricing/SKILL.md) | Margin, credit packages, plans and limits |
| [run-locally](.claude/skills/run-locally/SKILL.md) | Install, configure and start the app |

To do it by hand, these are the files that matter:

| File | What it decides |
| --- | --- |
| `.env` (`NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_APP_URL`, `SUPPORT_EMAIL`) | Name, web address and support email. The admin console can change the support email at run time |
| [`content/brand.ts`](content/brand.ts) | The code's slug and repository, and the local placeholders |
| [`src/features/agent-setup/system-prompts.ts`](src/features/agent-setup/system-prompts.ts) | The agent's role and voice |
| [`src/features/agents/config.ts`](src/features/agents/config.ts) | Which Claude model each tier uses |
| [`src/app/globals.css`](src/app/globals.css) | Theme tokens |
| [`src/features/skills/constants.ts`](src/features/skills/constants.ts) and [`content/`](content) | Bundled skills |
| [`src/features/billing/pricing-config.ts`](src/features/billing/pricing-config.ts) | Margin, credits and limits |
| [`src/features/integrations/config.ts`](src/features/integrations/config.ts) | Which connected apps are allowed |
| [`content/legal.ts`](content/legal.ts) | Terms and privacy text |

Run `pnpm seed:agents` after you change a system prompt or model, because the agents on Anthropic keep the last seeded version. The [configuration map](docs/spec/03b-configuration-map.md) names the file behind every other setting.

## Project structure

```text
content/            Brand, legal text, bundled skills and release notes
docs/               Deploy guide, operator commands, specs and design decisions
scripts/            Setup, migrations, agent and Stripe seeding, config checks
src/app/            Next.js routes, kept thin
src/features/       Business logic, one folder per feature (chat, files, billing, ...)
src/components/     Shared UI components and icons
src/db/             Drizzle schema and migrations
tests/              Unit, integration and end-to-end tests
.claude/skills/     Playbooks for customizing and running a fork with Claude Code
```

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), then the [code standard](docs/spec/01-code-standard.md) and [patterns](docs/spec/03-patterns.md). Run `pnpm verify` before you open a pull request. It runs formatting, lint, dead-code, type, unit, schema-drift and build checks, the same gate CI runs.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately through GitHub's **Report a vulnerability** form, not a public issue. See [SECURITY.md](SECURITY.md).

## FAQ

<details>
<summary><strong>Is Just a Wrapper free?</strong></summary>

Yes. The code is free and open source under the MIT license, including for commercial use. You pay your own providers: Anthropic for model usage, plus any optional services you turn on, such as Neon, Vercel, Composio or Stripe.

</details>

<details>
<summary><strong>Which AI models does it use?</strong></summary>

Claude models through Claude Managed Agents. The three tiers default to Claude Haiku 5.5, Sonnet 5.5 and Opus 5.5, set in [`src/features/agents/config.ts`](src/features/agents/config.ts). Image, video and voice tools run through Vercel AI Gateway. The agent runtime is Anthropic's, so other chat models are not supported.

</details>

<details>
<summary><strong>Can I self-host it?</strong></summary>

Yes. It is a Next.js app with a Postgres database. Vercel is the documented path, and any Node host works with its own scheduler for the cron routes. The agents themselves run on Anthropic's Managed Agents platform under your API key.

</details>

<details>
<summary><strong>How does billing work?</strong></summary>

Billing is off until you add a Stripe key. With Stripe, workspaces subscribe to a monthly plan that adds credits every cycle, and can buy more credits once. Run `pnpm seed:stripe` to create the plan prices. Set `BILLING_MODE=credits_only` to sell credits only, with no plans ([decision 0047](docs/decisions/0047-subscriptions-with-a-fenced-credits-only-mode.md) lists how to delete that mode). Each agent turn and paid tool call is converted to credits from the cost the provider actually reports. The default margin is zero, so one credit costs one cent. Change `MARGIN_PERCENT` in [`pricing-config.ts`](src/features/billing/pricing-config.ts) to charge more.

</details>

<details>
<summary><strong>Is it a ChatGPT or Claude.ai alternative?</strong></summary>

It covers the same ground for a team: chat, files, memory, shared workspaces, connected apps and scheduled tasks. The difference is that you own it. It runs on your database, your Anthropic account and your domain, and you can change any part of it.

</details>

<details>
<summary><strong>How do I connect Gmail, Google Drive or other apps?</strong></summary>

Set the Composio keys and the MCP proxy values from `.env.example`, then run `pnpm seed:agents`. Members connect their accounts from the app. Owners and admins can share one account per app with the whole workspace. The allowed apps and actions are listed in [`src/features/integrations/config.ts`](src/features/integrations/config.ts).

</details>

## License

[MIT](LICENSE).

This is an unofficial project. It is not affiliated with, endorsed by or sponsored by Anthropic. Claude is a trademark of Anthropic.
