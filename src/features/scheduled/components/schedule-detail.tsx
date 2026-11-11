'use client';

import Link from 'next/link';
import { useState } from 'react';
import { IconArrowUpRight, IconEdit01 } from '@/components/icons';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { Button } from '@/components/ui/button';
import { ModalContent, ModalFooter } from '@/components/ui/modal';
import { scheduleLabel } from '@/features/tasks/lib/schedule-label';
import type { EditableTask, TaskScheduledItem } from '@/features/tasks/types';
import { formatDateTime } from '@/lib/format/format-date';
import { cn } from '@/lib/utils';
import { futureNextRun } from '../lib/next-run';
import { ReviewBadge } from './review-badge';

export function ScheduleDetail({
  task,
  summary,
  editable,
  onEdit,
  onClose,
}: {
  task: EditableTask;
  summary: TaskScheduledItem | undefined;
  editable: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [openedAt] = useState(() => Date.now());
  const display = useDisplayFormat();
  const directRunAt = task.runAt ? new Date(task.runAt) : null;
  const nextRun = futureNextRun(summary ? summary.occurredAt : directRunAt, openedAt);

  return (
    <>
      <ModalContent className="gap-7">
        <section className="space-y-2" aria-labelledby="schedule-prompt-heading">
          <h3 id="schedule-prompt-heading" className="text-meta font-medium text-muted-foreground">
            Prompt
          </h3>
          <p className="whitespace-pre-wrap text-body text-foreground">{task.description}</p>
        </section>

        <section className="space-y-2" aria-labelledby="schedule-criteria-heading">
          <h3
            id="schedule-criteria-heading"
            className="text-meta font-medium text-muted-foreground"
          >
            Done criteria
          </h3>
          <p className="whitespace-pre-wrap text-body text-foreground">
            {task.successCriteria || 'No done criteria'}
          </p>
        </section>

        <dl className="grid gap-4 rounded-lg bg-alpha-3 p-4 sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-meta font-medium text-muted-foreground">Runs</dt>
            <dd className="text-title-card text-foreground">
              {summary
                ? scheduleLabel(summary, { kind: 'person', timeFormat: display.timeFormat })
                : 'Schedule unavailable'}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-meta font-medium text-muted-foreground">Next run</dt>
            <dd className="text-title-card text-foreground tabular">
              {nextRun ? formatDateTime(nextRun, display) : 'No next run'}
            </dd>
          </div>
        </dl>

        <section className="space-y-3" aria-labelledby="schedule-runs-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="schedule-runs-heading" className="text-title-section">
              Past runs
            </h3>
            {summary && summary.timesRun > summary.runs.length ? (
              <span className="text-meta font-medium text-muted-foreground tabular">
                Showing {summary.runs.length} of {summary.timesRun}
              </span>
            ) : null}
          </div>
          {summary && summary.runs.length > 0 ? (
            <ul className="divide-y divide-alpha-6 border-y border-alpha-6">
              {summary.runs.map((run) => (
                <li key={run.id}>
                  <Link
                    href={run.href}
                    className={cn(
                      'flex min-h-14 items-center gap-3 rounded-md px-2 py-2',
                      'hover:bg-alpha-6',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-title-card text-foreground tabular">
                        {formatDateTime(run.occurredAt, display)}
                      </span>
                      <span className="block truncate text-meta text-muted-foreground">
                        {run.title ?? 'Result chat'}
                      </span>
                    </span>
                    {run.reviewOutcome ? <ReviewBadge outcome={run.reviewOutcome} /> : null}
                    <IconArrowUpRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-alpha-3 px-4 py-5 text-meta text-muted-foreground">
              No runs yet
            </p>
          )}
        </section>
      </ModalContent>
      <ModalFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
        {editable ? (
          <Button type="button" onClick={onEdit}>
            <IconEdit01 className="size-4" />
            Edit
          </Button>
        ) : null}
      </ModalFooter>
    </>
  );
}
