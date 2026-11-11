import type { StripeCatalogReconciliation } from '@/features/billing/api/reconcile-stripe-catalog';
import type { AdminPageSlug } from '../lib/slugs';

export type OverviewRow = {
  name: string;
  /** `quiet` means off or unanswered: never a fault, and never shown as working. */
  tone: 'ready' | 'attention' | 'quiet';
  status: string;
  page: AdminPageSlug;
};

export type OverviewGroup = {
  title: 'Engine' | 'Agent' | 'Money' | 'Look' | 'Tracking';
  rows: readonly OverviewRow[];
};

export type DatabaseProbe =
  /** The database answered and the first migration's table is in it. */
  | { kind: 'ready' }
  /** The database answered and the first migration's table is not in it. */
  | { kind: 'no-schema' }
  /** The database did not answer, so this says nothing about its schema. */
  | { kind: 'unknown' };

export type RequiredEnvFacts = {
  total: number;
  /** Server keys are validated at boot, so a rejection means this process differs from the one that started. */
  invalidServerKeys: readonly string[];
  /** NEXT_PUBLIC_ keys are baked in at build time, so a rejection says nothing about the running bundle. */
  invalidClientKeys: readonly string[];
};

export type AgentFacts = {
  /** Every tier id and the shared environment id are set; a session needs all of them. */
  isSeeded: boolean;
  driftKinds: readonly ('in-sync' | 'drifted' | 'unknown')[];
};

export type PostHogFacts = {
  serverKeySet: boolean;
  browserKeySet: boolean;
  isSynced: boolean;
  eventCount: number;
  dashboardCount: number;
};

export type OverviewFacts = {
  database: DatabaseProbe;
  requiredEnv: RequiredEnvFacts;
  hasAnthropicKey: boolean;
  agents: AgentFacts;
  installedVersion: string;
  promptSectionCount: number;
  skillCount: number;
  /** Null while connected apps are off. */
  connectedAppCount: number | null;
  stripe: StripeCatalogReconciliation;
  margin: string;
  planNames: readonly string[];
  brandName: string;
  previewHost: string;
  /** Null when the theme file could not be read. */
  themeTokenCount: number | null;
  posthog: PostHogFacts;
};
