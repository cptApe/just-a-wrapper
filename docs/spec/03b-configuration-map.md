# Configuration map

Each setting an operator can change lives in one file. Edit the file below rather than adding a second registry.

| Surface | File | What it drives |
|---|---|---|
| Brand identity | Env: `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_APP_URL`, `EMAIL_FROM`. Run-time: `SUPPORT_EMAIL`, or the admin console (Brand, Contact). Code facts: [`content/brand.ts`](../../content/brand.ts) | Product name, web address, email sender and support address. Read only through [`src/lib/brand`](../../src/lib/brand): `identity.ts` for build-time values, `contact.ts` for run-time ones. The repository ships placeholders; `pnpm validate:config` and a production build fail until they are set ([decision 0048](../decisions/0048-brand-and-contact-come-from-configuration.md)) |
| Logo and favicon | [`src/components/brand/logo.tsx`](../../src/components/brand/logo.tsx), `src/app/icon.svg`, `src/app/favicon.ico`, `src/app/apple-icon.png` | The mark used by the page logo and Open Graph images, and the browser and home screen icons |
| Theme | [`src/app/globals.css`](../../src/app/globals.css) | Light and dark color variables, semantic mappings, radii, type roles, layout, elevation and motion tokens |
| Pricing | [`src/features/billing/pricing-config.ts`](../../src/features/billing/pricing-config.ts) | The margin every price derives from, the credit block, plan names, minimums and limits, credit packages, the one-time purchase minimum, annual discount, credit lifetimes, welcome credits, auto top-up defaults and the fixed-cost list. `catalog.ts` derives the Stripe plan prices `pnpm seed:stripe` creates in subscription mode. Vendor cost becomes credits in one function, `creditsForVendorCents` in `src/features/billing/lib/credit-math.ts` ([decision 0016](../decisions/0016-one-credit-one-margin.md)) |
| Billing mode, support email and other run-time settings | [`src/lib/deployment-settings/registry.ts`](../../src/lib/deployment-settings/registry.ts) | Settings an admin can change in the admin console, each with an env var as its base value (`BILLING_MODE`: `subscriptions` or `credits_only`; `SUPPORT_EMAIL`). A stored value wins over env. Add a setting with one entry there plus its env key; `required: true` makes the checks refuse its placeholder ([decision 0047](../decisions/0047-subscriptions-with-a-fenced-credits-only-mode.md)) |
| Optional providers | [`src/lib/capabilities.ts`](../../src/lib/capabilities.ts) | One decision per provider, resolved once from the environment (table below) |
| Connected apps | [`src/lib/composio/toolkits.ts`](../../src/lib/composio/toolkits.ts) | Composio allowlist, display order, groups, names, search tags, descriptions and catalog behavior |
| Skill packs | [`src/features/skills/constants.ts`](../../src/features/skills/constants.ts) | Preset skill names, upload directories, source directories and the ordered pack provisioned to workspaces |
| Agent tiers | [`src/features/agents/config.ts`](../../src/features/agents/config.ts) | Fast, Balanced and Expert model definitions, capability flags, display copy and environment-scoped agent names |
| Agent prompts | [`src/features/agent-setup/system-prompts.ts`](../../src/features/agent-setup/system-prompts.ts) | The instructions each agent tier receives. Run `pnpm seed:agents` after a change, because the agents on Anthropic keep the last seeded text |
| Required environment | [`src/lib/env-schema.ts`](../../src/lib/env-schema.ts) | Required setup values shared by runtime validation and `pnpm validate:config`, and the rule that refuses the admin and dev route flags and `DATABASE_WS_PROXY` in production. Placeholder brand values are refused in production by [`src/lib/brand/requirements.ts`](../../src/lib/brand/requirements.ts) |
| Full runtime environment | [`src/lib/env.ts`](../../src/lib/env.ts) | Optional provider keys, public runtime variables, defaults and the typed `env` export |

## Optional providers

`resolveCapabilitiesFromEnv` in `src/lib/capabilities.ts` is the one place environment values become capabilities. The app and the agent drift check (through `src/lib/runtime-capabilities.ts`) and the agent seed script (through `src/features/agent-setup/seed-plan.ts`) call it, so their plans cannot differ. See [decision 0009](../decisions/0009-capabilities-resolved-once.md).

| Capability | On when | Otherwise |
|---|---|---|
| `googleSignIn` | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set | Off. Setting only one is rejected at startup. Both Better Auth and the login page read this capability |
| `email` | `RESEND_API_KEY` is set (Resend) | Console output in development, off elsewhere |
| `media` | `AI_GATEWAY_API_KEY` is set | Off: the agent is not offered media tools |
| `webSearch` | `EXA_API_KEY` is set (Exa) | Anthropic's native web tools |
| `browser` | `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` are both set | Sandbox browsing. Setting only one is rejected at startup |
| `billing` | `STRIPE_SECRET_KEY` is set. Its mode comes from `billingCapability()`: `subscriptions` unless `BILLING_MODE` or the admin console says `credits_only` | Off: no credit or plan limits, no provider budgets, no billing or usage screens |
| `connectedApps` | `COMPOSIO_API_KEY` is set, with `MCP_PROXY_URL` and `MCP_PROXY_JWT_SECRET` | Off. A Composio key without both proxy values is rejected at startup |
| `storage` | `BLOB_READ_WRITE_TOKEN` is set (Vercel Blob) | Off: uploads, Library saves and previews of stored files refuse with the "File uploads are off" sentence |

A fresh local install signs in with the code printed in the `pnpm dev` log. A hosted install that signs in by email needs Resend and a verified sender.

## Checks

Run `pnpm validate:config` after changing any of these surfaces. It checks brand values still on their placeholders, preset skill directory slugs, connected app and tier shape, pricing (the plan catalog only in subscription mode), and required environment values, with failures an operator can read. `tests/configuration/config-validation.test.mjs` checks that the validator refuses each kind of bad value and names its fix.
