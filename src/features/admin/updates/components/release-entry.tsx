import type { KitRelease } from '@content/changelog';
import { AdminAgentButton } from '@/components/admin/agent-button';
import { Badge } from '@/components/ui/badge';
import { formatCalendarDate } from '@/lib/format/format-date';
import { PULL_THIS_UPDATE_ACTION, releaseCopy } from '../copy';
import { formatMergePrompt } from '../merge-prompt';

// A release date is a calendar day, so no reader's zone can move it.
function releaseDate(date: string): string {
  return formatCalendarDate(date);
}

type ReleaseStatus = 'included' | 'newer' | 'unknown';

export function ReleaseEntry({ release, status }: { release: KitRelease; status: ReleaseStatus }) {
  const copy = releaseCopy(release);

  return (
    <article className="flex flex-col gap-5 rounded-lg bg-alpha-3 p-4 sm:p-5">
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <time className="text-meta font-medium text-foreground-tertiary" dateTime={release.date}>
            {releaseDate(release.date)}
          </time>
          <Badge variant="muted" aria-label={`Version ${release.version}`}>
            {release.version}
          </Badge>
        </div>
        <h3 className="text-title-section">{copy.title}</h3>
      </header>

      <ul className="flex list-disc flex-col gap-2 pl-5 text-body text-muted-foreground marker:text-foreground-tertiary">
        {copy.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>

      {status === 'newer' ? (
        <div>
          <AdminAgentButton
            action={PULL_THIS_UPDATE_ACTION}
            accessibleLabel={`Ask your agent to pull update ${release.version}`}
            op="admin.copy-update-prompt"
            text={formatMergePrompt(release)}
          />
        </div>
      ) : null}
    </article>
  );
}
