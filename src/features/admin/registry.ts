import {
  type Icon,
  IconBarChart01,
  IconCreditCard01,
  IconGraduationHat01,
  IconHome02,
  IconMessageTextSquare01,
  IconPalette,
  IconPuzzlePiece01,
  IconRefreshCw01,
  IconSettings01,
  IconStars01,
} from '@/components/icons';
import { AppError } from '@/lib/errors';
import { ADMIN_PAGE_SLUGS, type AdminPageSlug } from './lib/slugs';

// The admin pages in rail order. The nav and the ⌘K menu are client components,
// so this module cannot import server code.

export type { AdminPageSlug } from './lib/slugs';
export {
  adminPageHref,
  isAdminPageActive,
  isAdminPageSlug,
} from './lib/slugs';

/** A repo-relative file the page reads from. */
export type AdminSourceFile = { path: string };

export type AdminPageMeta = {
  slug: AdminPageSlug;
  title: string;
  /** One plain line used by the Markdown twin and copy-prompt output. */
  purpose: string;
  group: 'general' | 'configure' | 'understand';
  icon: Icon;
  sourceFiles: readonly AdminSourceFile[];
};

/** One entry per slug, in slug order. The mapped type parameter keeps the
    `satisfies` below an exhaustiveness check. */
type PagesFor<T extends readonly AdminPageSlug[]> = {
  [K in keyof T]: AdminPageMeta & { slug: T[K] };
};
type AdminPageList = PagesFor<typeof ADMIN_PAGE_SLUGS>;

const ADMIN_PAGES = [
  {
    slug: 'overview',
    title: 'Overview',
    purpose: 'What this app is made of, and whether each part is working',
    group: 'general',
    icon: IconHome02,
    sourceFiles: [{ path: 'src/features/admin/overview/api/overview-facts.ts' }],
  },
  {
    slug: 'theme',
    title: 'Theme',
    purpose: 'Every design token, live values, and an edit mode over the running app',
    group: 'configure',
    icon: IconPalette,
    sourceFiles: [{ path: 'src/app/globals.css' }],
  },
  {
    slug: 'brand',
    title: 'Brand',
    purpose: 'The name and addresses this app ships under, and the tags they produce',
    group: 'configure',
    icon: IconStars01,
    sourceFiles: [
      { path: 'src/lib/brand/identity.ts' },
      { path: 'src/lib/deployment-settings/registry.ts' },
      { path: 'content/brand.ts' },
      { path: 'src/features/admin/brand/page-metadata.ts' },
      { path: 'src/app/opengraph-image.tsx' },
    ],
  },
  {
    slug: 'pricing',
    title: 'Pricing',
    purpose: 'Your margin, your plans, and what every credit is spent on',
    group: 'configure',
    icon: IconCreditCard01,
    sourceFiles: [
      { path: 'src/features/billing/pricing-config.ts' },
      { path: 'src/lib/deployment-settings/registry.ts' },
      { path: 'src/features/billing/lib/credit-math.ts' },
      { path: 'src/features/billing/lib/credit-rules-copy.ts' },
      { path: 'src/features/agents/config.ts' },
    ],
  },
  {
    slug: 'analytics',
    title: 'Analytics',
    purpose: 'What this app tracks, what it never sends, and the dashboards that read it',
    group: 'configure',
    icon: IconBarChart01,
    sourceFiles: [
      { path: 'src/lib/analytics-events.ts' },
      { path: 'src/features/admin/analytics/lib/analytics-dashboards.ts' },
      { path: 'src/features/admin/analytics/lib/event-explanations.ts' },
      { path: 'scripts/posthog-sync.ts' },
    ],
  },
  {
    slug: 'environment',
    title: 'Environment',
    purpose: 'Every environment variable this app reads, and whether it is set',
    group: 'configure',
    icon: IconSettings01,
    sourceFiles: [
      { path: 'src/lib/env-schema.ts' },
      { path: 'src/lib/env.ts' },
      { path: 'src/features/admin/environment/lib/env-registry.ts' },
    ],
  },
  {
    slug: 'prompts',
    title: 'Prompts',
    purpose: 'Every prompt this app sends a model, and whether the live agents still run them',
    group: 'understand',
    icon: IconMessageTextSquare01,
    sourceFiles: [
      { path: 'src/features/agent-setup/system-prompts.ts' },
      { path: 'src/features/sessions/lib/session-context.ts' },
      { path: 'src/features/sessions/lib/title-prompt.ts' },
      {
        path: 'src/features/tasks/lib/build-deployment-initial-events.ts',
      },
    ],
  },
  {
    slug: 'skills',
    title: 'Skills',
    purpose: 'The bundled skills and what each one teaches the agent',
    group: 'understand',
    icon: IconGraduationHat01,
    sourceFiles: [{ path: 'src/features/skills/constants.ts' }],
  },
  {
    slug: 'integrations',
    title: 'Integrations',
    purpose: 'Which outside apps this app reaches, and how permission is decided',
    group: 'understand',
    icon: IconPuzzlePiece01,
    sourceFiles: [
      { path: 'src/lib/composio/toolkits.ts' },
      { path: 'src/features/permissions/lib/resolve.ts' },
    ],
  },
  {
    slug: 'updates',
    title: 'Updates',
    purpose: 'What changed upstream and what it would take to pull it in',
    group: 'general',
    icon: IconRefreshCw01,
    sourceFiles: [{ path: 'content/changelog.ts' }],
  },
] satisfies AdminPageList;

export const ADMIN_NAV_PAGES: readonly AdminPageMeta[] = ADMIN_PAGES;

const BY_SLUG = new Map<AdminPageSlug, AdminPageMeta>(ADMIN_PAGES.map((page) => [page.slug, page]));

export function adminPageMeta(slug: AdminPageSlug): AdminPageMeta {
  const meta = BY_SLUG.get(slug);
  if (!meta) {
    throw new AppError('UNEXPECTED', 'No admin page is registered under that slug', { slug });
  }
  return meta;
}
