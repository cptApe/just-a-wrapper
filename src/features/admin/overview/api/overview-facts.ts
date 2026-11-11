import 'server-only';
import { getTierConfigDrift } from '@/features/agent-setup/api/prompt-drift';
import { promptSections } from '@/features/agent-setup/system-prompts';
import { AGENT_TIER_LIST } from '@/features/agents/config';
import { reconcileStripeCatalog } from '@/features/billing/api/reconcile-stripe-catalog';
import { marginSummary } from '@/features/billing/lib/pricing-admin-model';
import { PLAN_TIERS, PLANS } from '@/features/billing/pricing-config';
import { ANTHROPIC_DOCUMENT_SKILLS, PRESET_SKILLS } from '@/features/skills/constants';
import { readThemeTokens } from '@/features/theme/api/read-theme-tokens';
import { brand } from '@/lib/brand/identity';
import { ENABLED_TOOLKITS } from '@/lib/composio/toolkits';
import { isEnvironmentKeySet, rejectedEnvironmentKeys } from '@/lib/env';
import { requiredClientEnvShape, requiredServerEnvShape } from '@/lib/env-schema';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { capabilities } from '@/lib/runtime-capabilities';
import {
  analyticsDefinitionsForRecord,
  eventCount,
} from '../../analytics/lib/analytics-admin-model';
import { readAnalyticsStatus } from '../../analytics/lib/read-analytics-status';
import { resolvedOrigin } from '../../brand/origin';
import { readForkVersion } from '../../lib/fork-version';
import type { OverviewFacts } from '../types';
import { probeDatabase } from './database-probe';

// Key names and presence booleans are all that leave this module; values stay
// in env.ts.

const SEEDED_KEYS = [
  'ANTHROPIC_AGENT_ID_FAST',
  'ANTHROPIC_AGENT_ID_DEFAULT',
  'ANTHROPIC_AGENT_ID_PRO',
  'ANTHROPIC_ENVIRONMENT_ID',
] as const;

const CHECK_TIMEOUT_MS = 8_000;

/** What the page knows without calling anything, with every live check unanswered. */
export function uncheckedOverviewFacts(): OverviewFacts {
  const analytics = readAnalyticsStatus();
  return {
    database: { kind: 'unknown' },
    requiredEnv: {
      total:
        Object.keys(requiredServerEnvShape).length + Object.keys(requiredClientEnvShape).length,
      invalidServerKeys: rejectedEnvironmentKeys(requiredServerEnvShape),
      invalidClientKeys: rejectedEnvironmentKeys(requiredClientEnvShape),
    },
    hasAnthropicKey: isEnvironmentKeySet('ANTHROPIC_API_KEY'),
    agents: {
      isSeeded: SEEDED_KEYS.every(isEnvironmentKeySet),
      driftKinds: AGENT_TIER_LIST.map(() => 'unknown' as const),
    },
    installedVersion: 'unknown',
    promptSectionCount: promptSections(capabilities).length,
    skillCount: PRESET_SKILLS.length + ANTHROPIC_DOCUMENT_SKILLS.length,
    connectedAppCount: capabilities.connectedApps.kind === 'off' ? null : ENABLED_TOOLKITS.length,
    stripe: { status: 'unavailable' },
    margin: marginSummary().headline,
    planNames: PLAN_TIERS.map((tier) => PLANS[tier].name),
    brandName: brand.name,
    previewHost: resolvedOrigin().host,
    themeTokenCount: null,
    posthog: {
      serverKeySet: analytics.serverKeySet,
      browserKeySet: analytics.browserKeySet,
      isSynced: analytics.record !== null,
      eventCount: eventCount(),
      dashboardCount: analyticsDefinitionsForRecord(analytics.record).dashboards.length,
    },
  };
}

// The page still has to load when a dependency is down or slow, so a failed
// check is recorded and shown as unanswered.
async function answeredOr<T>(op: string, load: () => Promise<T>, unanswered: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new AppError('EXTERNAL_API_FAILED', 'An Overview check did not answer in time', {
          op,
          timeoutMs: CHECK_TIMEOUT_MS,
        }),
      );
    }, CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([load(), timedOut]);
  } catch (error) {
    captureException(error, { feature: 'admin', op });
    return unanswered;
  } finally {
    clearTimeout(timer);
  }
}

export async function readOverviewFacts(): Promise<OverviewFacts> {
  const unchecked = uncheckedOverviewFacts();
  const [database, driftKinds, stripe, installedVersion, themeTokenCount] = await Promise.all([
    answeredOr('overview.database', probeDatabase, unchecked.database),
    answeredOr(
      'overview.agents',
      async () => (await getTierConfigDrift()).map((tier) => tier.state.kind),
      unchecked.agents.driftKinds,
    ),
    answeredOr('overview.stripe', reconcileStripeCatalog, unchecked.stripe),
    answeredOr('overview.version', readForkVersion, unchecked.installedVersion),
    answeredOr(
      'overview.theme',
      async () => (await readThemeTokens()).length,
      unchecked.themeTokenCount,
    ),
  ]);
  return {
    ...unchecked,
    database,
    agents: { ...unchecked.agents, driftKinds },
    stripe,
    installedVersion,
    themeTokenCount,
  };
}
