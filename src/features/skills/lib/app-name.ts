import { TOOLKIT_METADATA } from '@/lib/composio/toolkits';
// Frontmatter uses toolkit slugs; the UI shows names from the client-safe integration registry.
export function connectionAppName(slug: string): string {
  const entry = Object.entries(TOOLKIT_METADATA).find(([key]) => key === slug);
  return entry ? entry[1].name : slug;
}
