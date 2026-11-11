import {
  ListRow,
  ListRowContent,
  ListRowMeta,
  ListRowTitle,
  ListRowTrailing,
} from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import { ENABLED_TOOLKITS, TOOLKIT_GROUPS, toolkitLogoUrl } from '@/lib/composio/toolkits';
import { IntegrationLogo } from './integration-logo';

// Names and descriptions are already known. Only connection status needs to
// wait for the member's live read; do not label unchecked apps disconnected.
export function AppsSectionSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Checking app connections"
      className="flex flex-col gap-8"
    >
      {TOOLKIT_GROUPS.map((group) => (
        <section key={group.id} aria-label={group.label} className="flex flex-col gap-2">
          <h3 className="text-title-card font-semibold text-muted-foreground">{group.label}</h3>
          <ul className="grid gap-y-1 sm:grid-cols-2 sm:gap-x-6">
            {ENABLED_TOOLKITS.filter((meta) => meta.group === group.id).map((meta) => (
              <li key={meta.slug} className="min-w-0">
                <ListRow className="min-h-16 font-medium hover:bg-transparent">
                  <IntegrationLogo
                    logoUrl={toolkitLogoUrl(meta.slug)}
                    name={meta.name}
                    slug={meta.slug}
                    size={40}
                  />
                  <ListRowContent>
                    <ListRowTitle>{meta.name}</ListRowTitle>
                    <ListRowMeta className="font-medium">{meta.blurb}</ListRowMeta>
                  </ListRowContent>
                  <ListRowTrailing>
                    <Skeleton className="size-6 rounded-full" />
                  </ListRowTrailing>
                </ListRow>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
