/**
 * What the code knows about the product. A deployment's own name, address and contact details are
 * configuration, not code: set them through env or the admin console (docs/spec/03b-configuration-map.md).
 * The placeholders below let local development and tests run; pnpm validate:config and a production
 * build fail until a deployment replaces them. Code reads every value through src/lib/brand, never
 * from this file. Colours live only in `src/app/globals.css`.
 */

/** Fixed facts about this codebase. A fork that renames its code or repository edits these. */
export const codeIdentity = {
  slug: 'just-a-wrapper',
  repositoryUrl: 'https://github.com/cptApe/just-a-wrapper',
  description: 'The open-source app around Claude Managed Agents.',
} as const;

/** Stand-ins until a deployment sets its own values. */
export const brandPlaceholders = {
  /** Replaced by NEXT_PUBLIC_BRAND_NAME. */
  name: 'Just a Wrapper',
  /** Replaced by NEXT_PUBLIC_APP_URL. */
  url: 'http://localhost:3000',
  /** Replaced by SUPPORT_EMAIL or the admin console. */
  supportEmail: 'support@example.com',
} as const;
