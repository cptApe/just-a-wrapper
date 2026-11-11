# Operator commands

Run these only with the intended deployment's environment configured. Commands that seed or clear caches change external state. Never include secrets or raw user data in shared output.

| Command | Purpose |
| --- | --- |
| `pnpm run setup` | Write `.env`, apply migrations and seed agents on a new clone. Safe to re-run. |
| `pnpm db:migrate` | Apply pending database migrations. |
| `pnpm seed:agents` | Preview without an API key, otherwise create/update deployment agents. |
| `pnpm seed:stripe` | Preview without a key, otherwise seed test billing; live mode requires `--live`. Plan prices only in subscription mode; credits-only mode ensures the top-up product and leaves plan prices alone. |
| `pnpm stripe:listen` | Forward Stripe test webhooks locally. |
| `pnpm validate:config` | Check repository configuration consistency. |
| `pnpm env:example` | Generate the public environment template without reading secrets. |
| `pnpm posthog:sync` | Synchronize analytics definitions with your configured PostHog project. |
| `pnpm skills:backfill` | Push preset skill changes to a deployment whose workspaces are already provisioned. |
| `pnpm composio:remint` | Clear cached member Tool Router sessions after changing the connected-app allowlist. |
