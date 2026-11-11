import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createLoader, type SearchParams } from 'nuqs/server';
import { Boundary } from '@/components/layouts/boundary';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { brand } from '@/lib/brand/identity';
import { capabilities } from '@/lib/runtime-capabilities';
import { normalizeUsageParams, usagePageParsers } from './usage-params';
import { UsageError, UsageShell } from './usage-shell';
import { UsagePageSkeleton } from './usage-skeleton';

export const metadata: Metadata = {
  title: `Usage · ${brand.name}`,
};

const loadUsageParams = createLoader(usagePageParsers);

// /app/settings/usage — the read view on the workspace's shared credit pool.
// Thin shell in the account/general layout: the title stays here (always
// mounted); everything below is the UsageShell, which resolves the workspace and
// renders the config row + section scaffolding around its OWN inner data
// boundaries, so a period change re-suspends only the data — never the controls.
// The outer Boundary here is the cold-load fallback only; on a period change the
// transition keeps this shell mounted and just the inner data regions pulse.
export default async function UsageSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (capabilities.billing.kind === 'off') notFound();
  const params = normalizeUsageParams(await loadUsageParams(searchParams));
  return (
    <div className="w-full md:pt-8">
      <SettingsPageHeader title="Usage" />
      <Boundary loading={<UsagePageSkeleton />} error={<UsageError />}>
        <UsageShell params={params} />
      </Boundary>
    </div>
  );
}
