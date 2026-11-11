import { brand } from '@/lib/brand/identity';

/** The search and link preview text for the root route. */
export const HOME_PAGE_METADATA = {
  route: '/',
  title: brand.name,
  description: brand.description,
} as const;
