# Brand and contact details come from configuration

- **Status:** Accepted.
- **Date:** November 2026

## Context

`content/brand.ts` held the name, web address and support email of one deployment, wrapper.arnas.st. Every fork shipped those values, and a fork that forgot one sent its users to the wrong mailbox. A support address is also something an operator wants to change without a redeploy.

## Decision

- **The repository ships placeholders.** [`content/brand.ts`](../../content/brand.ts) keeps only facts about the code (`codeIdentity`: slug, repository, description) and the stand-ins for local work (`brandPlaceholders`). Local development and tests run on them.
- **One rule for where a value is set.** A value the build bakes in, or that is needed before the database answers, is an env var. A value an operator may change while the app runs is a [deployment setting](0047-subscriptions-with-a-fenced-credits-only-mode.md) with an env var as its base, so production (no admin console) sets it in env and a console deployment can override it.

  | Value | Set in | Why |
  |---|---|---|
  | Product name | `NEXT_PUBLIC_BRAND_NAME` | Static metadata, Open Graph images and client components bake it in at build |
  | Web address and domain | `NEXT_PUBLIC_APP_URL` | Auth, links and the sitemap need it at build and before the database |
  | Email sender | `EMAIL_FROM`, else `<name> <hello@<domain>>` | Comes from the two values above; the domain must be verified in Resend |
  | Support email | `SUPPORT_EMAIL`, overridden by the admin console (Brand, Contact) | The Get help link, every email footer and the legal pages; safe to change at run time |
  | Slug, repository, description | `content/brand.ts` | Facts about the code, the same for every deployment of it |

- **One read path.** [`src/lib/brand/identity.ts`](../../src/lib/brand/identity.ts) gives the build-time values (`brand`, `SITE_URL`) on both sides. [`src/lib/brand/contact.ts`](../../src/lib/brand/contact.ts) gives the run-time ones (`readContactDetails()`); server layouts pass them to client components through `ContactDetailsProvider`. Nothing else reads these env vars or the settings table for a brand value.
- **Unset is refused where it matters.** [`requirements.ts`](../../src/lib/brand/requirements.ts) lists each value still on its placeholder. `pnpm validate:config` prints that list everywhere (a value stored in the admin console counts as set). A production deployment refuses to build or start with the same sentences. `pnpm seed:stripe --live` refuses without a name, because product names follow it.
- **Legal pages take the values.** `content/legal.ts` builds the terms and privacy text from the product name and support email. Its words still describe a one-person operator, so a fork rewrites them.

## Why

A name in static metadata cannot come from the database, and a support address should not need a deploy. Splitting by "does the build need it" gives one rule an operator can apply to any new value. The deployment settings store already gives validation, an audit and the env base, so contact details need no second store.

## Consequences

- A fork sets two env vars before its first production deploy, or the build fails and names them.
- Legal pages and the admin Brand page read the database on each request.
- Emails read the support address once per send. A template takes it as input, so templates stay pure.
- Adding a contact value is one registry entry with `required` set, plus its env key; the checks pick it up.
