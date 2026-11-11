import Link from 'next/link';
import { AdminSection } from '@/components/admin/admin-section';
import { IconChevronRight } from '@/components/icons';
import { Boundary } from '@/components/layouts/boundary';
import { Skeleton } from '@/components/ui/skeleton';
import { withRequestContext } from '@/lib/request-context';
import { cn } from '@/lib/utils';
import { adminPageHref } from '../../lib/slugs';
import { readOverviewFacts, uncheckedOverviewFacts } from '../api/overview-facts';
import { overviewGroups } from '../lib/overview-rows';
import type { OverviewGroup, OverviewRow } from '../types';

const TONE_DOT: Record<OverviewRow['tone'], string> = {
  ready: 'border-success-strong bg-success-strong',
  attention: 'border-warning bg-warning',
  quiet: 'border-alpha-24 bg-transparent',
};

function RowLink({ row, isChecking }: { row: OverviewRow; isChecking: boolean }) {
  return (
    <li>
      <Link
        href={adminPageHref(row.page)}
        className="flex min-h-11 items-center gap-3 py-2 hover:bg-alpha-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 text-body text-foreground">{row.name}</span>
        {isChecking ? (
          <Skeleton aria-hidden className="h-4 w-24" />
        ) : (
          <>
            <span className="min-w-0 text-right text-meta text-muted-foreground">{row.status}</span>
            <span
              aria-hidden
              className={cn('size-2 shrink-0 rounded-full border-[1.5px]', TONE_DOT[row.tone])}
            />
          </>
        )}
        <IconChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

function OverviewBoard({
  groups,
  isChecking = false,
}: {
  groups: readonly OverviewGroup[];
  isChecking?: boolean;
}) {
  return (
    <div aria-busy={isChecking} className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
      {groups.map((group) => (
        <AdminSection key={group.title} title={group.title}>
          <ul className="divide-y divide-border border-y border-border">
            {group.rows.map((row) => (
              <RowLink key={row.name} row={row} isChecking={isChecking} />
            ))}
          </ul>
        </AdminSection>
      ))}
    </div>
  );
}

async function CheckedBoard() {
  const facts = await withRequestContext({ route: 'admin-overview-page' }, readOverviewFacts);
  return <OverviewBoard groups={overviewGroups(facts)} />;
}

export function OverviewAdmin() {
  const unchecked = overviewGroups(uncheckedOverviewFacts());
  return (
    <Boundary
      loading={<OverviewBoard groups={unchecked} isChecking />}
      error={<OverviewBoard groups={unchecked} />}
    >
      <CheckedBoard />
    </Boundary>
  );
}
