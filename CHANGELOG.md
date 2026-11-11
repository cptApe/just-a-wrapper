# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The in-app release notes for people running a fork live in [`content/changelog.ts`](content/changelog.ts).

## [Unreleased]

## [1.0.0] - 2026-11-11

First public release. The code was developed privately and is published as a single commit, so this entry summarizes what exists rather than listing every change. The reasons behind the design are recorded in [docs/decisions](docs/decisions/README.md).

### Added

- Chat with agents on Claude Managed Agents, with streamed steps, kept sessions, follow-ups sent while the agent works, and three model tiers (Fast, Balanced and Expert).
- Workspaces with members, roles, email invitations and private-by-default sharing with a Team folder.
- A file library with private uploads, previews for common document, image and video formats, and share links.
- Memory across chats, bundled skills and skills that members write or the agent saves.
- Connected apps through Composio behind the app's own MCP proxy, with shared or personal accounts per app.
- Web search and page reading, a cloud browser, image and video generation, voice input and read-aloud, and charts.
- Scheduled tasks on Anthropic's scheduler, with in-app and email notifications and daily digests.
- Sign-in with email codes or Google through Better Auth.
- Billing on Stripe: subscription plans by default, or prepaid credits metered from actual provider cost.
- An operator console at `/admin`, off by default.
- Optional PostHog analytics.
- `pnpm run setup` for a one-command local install, a Vercel deploy guide, and Claude Code playbooks in `.claude/skills/` for rebranding and repricing a fork.
- `pnpm verify` as the single quality gate, run by CI along with database integration tests on real Postgres and Playwright smoke tests.

[Unreleased]: https://github.com/cptApe/just-a-wrapper/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/cptApe/just-a-wrapper/releases/tag/v1.0.0
