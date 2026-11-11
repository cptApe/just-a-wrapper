---
name: customize-brand
description: Rename and rebrand this app across configuration, bundled preset skills, content, and generated metadata. Use when changing the product name, slug, web address, support address, or logo. Colours belong to the customize-theme skill.
---

# Customize the brand

A deployment's name, web address and contact details are configuration, not code ([decision 0048](../../../docs/decisions/0048-brand-and-contact-come-from-configuration.md)). Never write them into `content/brand.ts` or `src`. Read `docs/spec/03b-configuration-map.md` and `src/features/skills/constants.ts` before editing.

## Gather the new identity

Confirm the product name, the canonical HTTPS URL without a trailing slash, the support email, and whether the code itself is renamed (a new lowercase hyphenated slug or repository). Do not invent missing customer-facing values. Colours are not part of the brand: change them in `src/app/globals.css` with the customize-theme skill.

## Set the configuration

| Value | Where |
|---|---|
| Product name | `NEXT_PUBLIC_BRAND_NAME` in `.env` and the host's environment settings. Fixed at build time: redeploy after changing it |
| Web address | `NEXT_PUBLIC_APP_URL`, same places. Also update the callback and webhook URLs in `docs/deploy.md` |
| Email sender | `EMAIL_FROM`, or leave it unset for `<name> <hello@<domain>>`; the domain must be verified in Resend |
| Support email | `SUPPORT_EMAIL` in env. Where the admin console runs, an admin can change it under Brand, Contact, and that value wins |

Tell the operator which values to set; do not paste secrets or real values into committed files. `pnpm validate:config` lists every value still on its placeholder.

## Apply the rename

1. If the code is renamed, change `codeIdentity` in `content/brand.ts` (slug, repository, description). Leave `brandPlaceholders` as placeholders.
2. Search the repository for the old display name and slug. Replace product copy, examples, and bundled content that should follow the brand. Investigate each result instead of blindly changing historical records, external identifiers, migrations, or unrelated prose.
3. The app guide has a brand-independent name, so `content/app-guide`, `APP_GUIDE_DIRECTORY` and its `contentDir` stay as they are. Update the user-visible copy inside that folder. Its description derives from the configured name. A preset row whose name is no longer in `PRESET_SKILLS` counts as retired (`isRetiredPresetRow` in `src/features/skills/lib/preset-retirement.ts`): it stays stored and is hidden from lists and new sessions.
4. Replace the logo if the brand changes. The mark lives in `src/app/icon.svg` (black in light mode, white in dark mode) and as `LOGO_MARK_PATH` in `src/components/brand/logo.tsx`, which the page logo and both Open Graph images read. Render `src/app/favicon.ico` (16, 32 and 48 px, white mark on a square `#0e0f0c` tile) and `src/app/apple-icon.png` (180 px, same tile, square corners because iOS rounds them) from that path.
5. Review `content/legal.ts`. The name and support email come in from configuration, but the words describe a one-person operator, the processors and the refund policy. Replace anything that does not fit your service before you publish.

## Preserve the preset invariant

Anthropic requires the upload directory to equal the slug of the skill name. The repository enforces the same contract in `scripts/config-validation.ts` and `tests/skills/preset-content-dirs.test.mjs`.

For example, the display name `App Guide` requires all of these to agree:

```text
registry name: App Guide
upload directory: app-guide
content directory: content/app-guide
SKILL.md name: App Guide
```

Classic failures are leaving an empty slug, deploying with the placeholder name or support email, pointing `contentDir` at a folder that does not exist, or changing a preset name without changing its folder and `SKILL.md` name. A renamed Anthropic skill is a new upstream skill identity; it cannot be published as a new version under the old name.

## Verify

Run:

```bash
pnpm validate:config
node --import ./scripts/register-aliases.mjs --test tests/skills/preset-content-dirs.test.mjs
rg -n "OLD DISPLAY NAME|old-slug" src content scripts
pnpm verify
```

Review every remaining old-brand match and report why it stays. Also review the home page, sign-in, email previews, Open Graph image, and a newly provisioned preset skill when browser or provider access is in scope.
