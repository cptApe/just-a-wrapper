'use client';

import { IconFlipBackward } from '@/components/icons';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { Button } from '@/components/ui/button';
import { MarkdownMessage } from '@/components/ui/markdown-message';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes } from '@/lib/format/format-bytes';
import { formatDate } from '@/lib/format/format-date';
import { cn } from '@/lib/utils';
import { useMemoryHistory } from '../api/use-memory-history';
import type { MemoryNote, MemoryNoteVersion } from '../lib/notes';
import type { MemoryScope } from '../types';

const ACTOR_LABELS: Record<MemoryNoteVersion['actor'], string> = {
  agent: 'Agent',
  app: 'In the app',
  user: 'Console',
};

const OPERATION_LABELS: Record<MemoryNoteVersion['operation'], string> = {
  created: 'Created',
  modified: 'Edited',
  deleted: 'Deleted',
};

export function MemoryHistoryPanel({
  scope,
  note,
  canEdit,
  onRestored,
}: {
  scope: MemoryScope;
  note: MemoryNote;
  canEdit: boolean;
  onRestored: () => void;
}) {
  const { query, preview, previewError, pending, actions } = useMemoryHistory(
    scope,
    note,
    onRestored,
  );
  const { openPreview, restore, closePreview } = actions;
  const { timeZone } = useDisplayFormat();
  const versions = query.data?.pages.flatMap((page) => page.versions) ?? [];
  return (
    <aside
      className="flex max-h-[50%] w-full shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain border-t border-alpha-6 pt-4 sm:max-h-none sm:w-[260px] sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0"
      aria-label="Note history"
    >
      <h3 className="text-title-card text-foreground">History</h3>
      <p className="text-meta font-normal text-muted-foreground">
        Every change is kept for 30 days. Preview a version, then restore it.
      </p>
      {previewError !== null ? (
        <p role="alert" className="text-meta text-destructive">
          Couldn’t load this version. {previewError}
        </p>
      ) : null}
      {preview !== null ? (
        <div className="flex flex-col gap-2 rounded-xl bg-alpha-6 p-3">
          <p className="text-meta font-normal text-muted-foreground">
            {OPERATION_LABELS[preview.version.operation]} ·{' '}
            {formatDate(preview.version.createdAt, timeZone)} ·{' '}
            {ACTOR_LABELS[preview.version.actor]}
          </p>
          <div className="max-h-56 overflow-y-auto text-meta">
            {preview.content !== null && preview.content.trim() !== '' ? (
              <MarkdownMessage text={preview.content} />
            ) : (
              <p className="text-meta text-muted-foreground">No content in this version.</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canEdit ? (
              <Button
                type="button"
                size="xs"
                onClick={() => restore(preview.version)}
                disabled={pending}
              >
                <IconFlipBackward className="size-3.5" /> Restore
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="xs" onClick={closePreview}>
              Close preview
            </Button>
          </div>
        </div>
      ) : null}
      {query.isPending ? (
        <div className="flex flex-col gap-2 pt-1" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="text-meta text-destructive">
          Couldn’t load the history.{' '}
          <Button type="button" variant="ghost" size="xs" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </p>
      ) : versions.length === 0 ? (
        <p className="text-meta text-muted-foreground">No versions yet.</p>
      ) : (
        <ul className="flex flex-col">
          {versions.map((version) => (
            <li key={version.id}>
              <button
                type="button"
                onClick={() => openPreview(version)}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left',
                  'hover:bg-alpha-6',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  preview?.version.id === version.id && 'bg-alpha-8',
                )}
              >
                <span className="text-meta font-normal text-foreground">
                  {OPERATION_LABELS[version.operation]} · {ACTOR_LABELS[version.actor]}
                </span>
                <span className="text-meta font-normal text-muted-foreground">
                  {formatDate(version.createdAt, timeZone)}
                  {version.sizeBytes !== null ? ` · ${formatBytes(version.sizeBytes)}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <Button type="button" variant="ghost" size="xs" onClick={() => void query.fetchNextPage()}>
          Load more
        </Button>
      ) : null}
    </aside>
  );
}
