// Kept apart from the registry so the markdown route and the tests can load the
// slugs without the icon components.

export const ADMIN_PAGE_SLUGS = [
  'overview',
  'theme',
  'brand',
  'pricing',
  'analytics',
  'environment',
  'prompts',
  'skills',
  'integrations',
  'updates',
] as const;

export type AdminPageSlug = (typeof ADMIN_PAGE_SLUGS)[number];

export function isAdminPageSlug(value: string): value is AdminPageSlug {
  return ADMIN_PAGE_SLUGS.some((slug) => slug === value);
}

export function adminPageHref(slug: AdminPageSlug): string {
  return slug === 'overview' ? '/admin' : `/admin/${slug}`;
}

export function isAdminPageActive(pathname: string, slug: AdminPageSlug): boolean {
  const href = adminPageHref(slug);
  if (slug === 'overview') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
