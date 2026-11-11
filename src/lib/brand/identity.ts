import { brandPlaceholders, codeIdentity } from '@content/brand';

// The product's name and public address, fixed when the app is built. Safe in the browser.
// Contact details change at run time and come from ./contact instead.
//
// Read raw because Next inlines NEXT_PUBLIC_* only at a literal process.env.NAME. Unset values
// fall back to placeholders so local development runs; pnpm validate:config and a production
// build refuse them (./requirements.ts).
const configuredName = process.env.NEXT_PUBLIC_BRAND_NAME?.trim();
const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

const url = (configuredUrl || brandPlaceholders.url).replace(/\/+$/, '');

export const brand = {
  /** What people see: the browser tab, emails, the sign-in page, how the agent introduces itself. */
  name: configuredName || brandPlaceholders.name,
  /** The public origin, no trailing slash. */
  url,
  /** The host of `url`, the default email sender domain. */
  domain: URL.canParse(url) ? new URL(url).hostname : url,
  slug: codeIdentity.slug,
  description: codeIdentity.description,
  repositoryUrl: codeIdentity.repositoryUrl,
} as const;

/** Whether the origin is the placeholder because NEXT_PUBLIC_APP_URL is unset. */
export const siteUrlIsPlaceholder = !configuredUrl;

/** The canonical origin every SEO surface and absolute link resolves against. */
export const SITE_URL = brand.url;
