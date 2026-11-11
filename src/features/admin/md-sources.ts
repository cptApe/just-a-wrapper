import 'server-only';
import { pricingAdminMarkdown } from '@/features/billing/lib/pricing-admin-markdown';
import { integrationsAdminMarkdown } from '@/features/integrations/lib/admin-page-content';
import { skillsAdminMarkdown } from '@/features/skills/server';
import { readThemeTokens } from '@/features/theme/api/read-theme-tokens';
import { themeReferenceMarkdown } from '@/features/theme/lib/theme-reference-markdown';
import { capabilities } from '@/lib/runtime-capabilities';
import { buildBrandMarkdown } from './brand/markdown';
import { readForkVersion } from './lib/fork-version';
import type { AdminPageSlug } from './registry';
import { changelogMarkdown } from './updates/changelog-markdown';

export const ADMIN_MD_SOURCES: Record<AdminPageSlug, () => Promise<string>> = {
  analytics: () =>
    import('./analytics/lib/analytics-admin-twin').then((m) => m.analyticsAdminTwin()),
  brand: async () => buildBrandMarkdown(),
  environment: () => import('./environment/lib/env-markdown').then((m) => m.environmentMarkdown()),
  integrations: async () => integrationsAdminMarkdown(),
  overview: () => import('./overview/lib/overview-markdown').then((m) => m.overviewMarkdown()),
  pricing: pricingAdminMarkdown,
  prompts: () =>
    import('@/features/agent-setup/lib/prompt-markdown').then((m) =>
      m.promptsMarkdown(capabilities),
    ),
  skills: skillsAdminMarkdown,
  theme: async () => themeReferenceMarkdown(await readThemeTokens()),
  updates: async () => changelogMarkdown(await readForkVersion()),
};
