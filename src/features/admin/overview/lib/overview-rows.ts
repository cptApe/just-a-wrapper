import { canReadVersion, KIT_VERSION, upstreamAhead } from '@content/changelog';
import type { StripeCatalogReconciliation } from '@/features/billing/api/reconcile-stripe-catalog';
import { plural } from '@/lib/format/plural';
import type {
  AgentFacts,
  DatabaseProbe,
  OverviewFacts,
  OverviewGroup,
  OverviewRow,
  PostHogFacts,
  RequiredEnvFacts,
} from '../types';

// A row is `ready` only when its check passed. A check that could not run is
// `quiet`, so an outage never reads as working.

const COULD_NOT_CHECK = 'Could not check';

export function databaseRow(probe: DatabaseProbe): OverviewRow {
  const base = { name: 'Database', page: 'environment' } as const;
  return probe.kind === 'unknown'
    ? { ...base, tone: 'quiet', status: 'Did not answer' }
    : { ...base, tone: 'ready', status: 'Connected' };
}

// The probe proves the schema exists, not that the newest migration ran:
// Drizzle's journal only records its own migrator, so counting it misreports
// a database restored from a dump.
export function migrationsRow(probe: DatabaseProbe): OverviewRow {
  const base = { name: 'Migrations', page: 'environment' } as const;
  switch (probe.kind) {
    case 'ready':
      return { ...base, tone: 'ready', status: 'Tables in place' };
    case 'no-schema':
      return { ...base, tone: 'attention', status: 'Not applied, run pnpm db:migrate' };
    case 'unknown':
      return { ...base, tone: 'quiet', status: COULD_NOT_CHECK };
  }
}

export function requiredEnvRow(facts: RequiredEnvFacts): OverviewRow {
  const base = { name: 'Required keys', page: 'environment' } as const;
  if (facts.invalidServerKeys.length > 0) {
    return { ...base, tone: 'attention', status: `Missing ${facts.invalidServerKeys.join(', ')}` };
  }
  if (facts.invalidClientKeys.length > 0) {
    return {
      ...base,
      tone: 'quiet',
      status: `Check the build: ${facts.invalidClientKeys.join(', ')}`,
    };
  }
  return { ...base, tone: 'ready', status: `All ${facts.total} set` };
}

export function anthropicKeyRow(hasKey: boolean): OverviewRow {
  const base = { name: 'Anthropic key', page: 'environment' } as const;
  return hasKey
    ? { ...base, tone: 'ready', status: 'Set' }
    : { ...base, tone: 'attention', status: 'Not set' };
}

export function agentsRow(facts: AgentFacts): OverviewRow {
  const base = { name: 'Agents in sync', page: 'prompts' } as const;
  if (!facts.isSeeded) {
    return { ...base, tone: 'attention', status: 'Not seeded, run pnpm seed:agents' };
  }
  const total = facts.driftKinds.length;
  const drifted = facts.driftKinds.filter((kind) => kind === 'drifted').length;
  if (drifted > 0) {
    return {
      ...base,
      tone: 'attention',
      status: `${drifted} of ${total} out of date, run pnpm seed:agents`,
    };
  }
  const allAnswered = total > 0 && facts.driftKinds.every((kind) => kind === 'in-sync');
  return allAnswered
    ? { ...base, tone: 'ready', status: 'In sync' }
    : { ...base, tone: 'quiet', status: COULD_NOT_CHECK };
}

export function versionRow(installedVersion: string): OverviewRow {
  const base = { name: 'Version', page: 'updates' } as const;
  if (!canReadVersion(installedVersion)) {
    return { ...base, tone: 'quiet', status: 'Could not read' };
  }
  return upstreamAhead(installedVersion)
    ? { ...base, tone: 'attention', status: `${installedVersion}, ${KIT_VERSION} available` }
    : { ...base, tone: 'ready', status: `${installedVersion}, the latest` };
}

function connectedAppsRow(appCount: number | null): OverviewRow {
  const base = { name: 'Connected apps', page: 'integrations' } as const;
  return appCount === null
    ? { ...base, tone: 'quiet', status: 'Off, no Composio key' }
    : { ...base, tone: 'ready', status: `${plural(appCount, 'app')} available` };
}

export function billingRow(stripe: StripeCatalogReconciliation): OverviewRow {
  const base = { name: 'Billing', page: 'pricing' } as const;
  switch (stripe.status) {
    case 'in-sync':
      return { ...base, tone: 'ready', status: 'On, prices match Stripe' };
    case 'not-seeded':
      return { ...base, tone: 'attention', status: 'On, prices not in Stripe yet' };
    case 'differs':
      return {
        ...base,
        tone: 'attention',
        status: `On, ${plural(stripe.issues.length, 'difference')} from Stripe`,
      };
    case 'not-configured':
      return { ...base, tone: 'quiet', status: 'Off, no Stripe key' };
    case 'plans-not-sold':
      return { ...base, tone: 'ready', status: 'On, credits only' };
    case 'unavailable':
      return { ...base, tone: 'quiet', status: COULD_NOT_CHECK };
  }
}

export function themeRow(tokenCount: number | null): OverviewRow {
  const base = { name: 'Theme', page: 'theme' } as const;
  return tokenCount === null
    ? { ...base, tone: 'quiet', status: 'Could not read' }
    : { ...base, tone: 'ready', status: plural(tokenCount, 'design token') };
}

function postHogRow(facts: PostHogFacts): OverviewRow {
  const base = { name: 'PostHog', page: 'analytics' } as const;
  if (facts.serverKeySet && facts.browserKeySet) return { ...base, tone: 'ready', status: 'On' };
  if (facts.serverKeySet) return { ...base, tone: 'attention', status: 'Server only' };
  if (facts.browserKeySet) return { ...base, tone: 'attention', status: 'Browser only' };
  return { ...base, tone: 'quiet', status: 'Off' };
}

function dashboardsRow(facts: PostHogFacts): OverviewRow {
  const base = { name: 'Dashboards', page: 'analytics' } as const;
  const dashboards = plural(facts.dashboardCount, 'dashboard');
  return facts.isSynced
    ? { ...base, tone: 'ready', status: `${dashboards}, synced` }
    : { ...base, tone: 'quiet', status: `${dashboards}, not synced` };
}

export function overviewGroups(facts: OverviewFacts): OverviewGroup[] {
  return [
    {
      title: 'Engine',
      rows: [
        databaseRow(facts.database),
        migrationsRow(facts.database),
        requiredEnvRow(facts.requiredEnv),
        anthropicKeyRow(facts.hasAnthropicKey),
        agentsRow(facts.agents),
        versionRow(facts.installedVersion),
      ],
    },
    {
      title: 'Agent',
      rows: [
        {
          name: 'Prompts',
          tone: 'ready',
          status: plural(facts.promptSectionCount, 'section'),
          page: 'prompts',
        },
        { name: 'Skills', tone: 'ready', status: `${facts.skillCount} included`, page: 'skills' },
        connectedAppsRow(facts.connectedAppCount),
      ],
    },
    {
      title: 'Money',
      rows: [
        billingRow(facts.stripe),
        { name: 'Margin', tone: 'ready', status: facts.margin, page: 'pricing' },
        { name: 'Plans', tone: 'ready', status: facts.planNames.join(', '), page: 'pricing' },
      ],
    },
    {
      title: 'Look',
      rows: [
        { name: 'Brand', tone: 'ready', status: facts.brandName, page: 'brand' },
        { name: 'Link previews', tone: 'ready', status: facts.previewHost, page: 'brand' },
        themeRow(facts.themeTokenCount),
      ],
    },
    {
      title: 'Tracking',
      rows: [
        postHogRow(facts.posthog),
        {
          name: 'Events',
          tone: 'ready',
          status: plural(facts.posthog.eventCount, 'event'),
          page: 'analytics',
        },
        dashboardsRow(facts.posthog),
      ],
    },
  ];
}
