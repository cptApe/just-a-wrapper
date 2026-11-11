// Slug helpers for personal-organization provisioning; they import nothing so unit tests need no database.

export const MAX_SLUG_ATTEMPTS = 5;

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'workspace'
  );
}

export const randomSuffix = (): string => Math.random().toString(36).slice(2, 8);
