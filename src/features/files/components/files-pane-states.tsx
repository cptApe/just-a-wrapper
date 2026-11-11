'use client';
import * as React from 'react';
import {
  IconFile02,
  IconImage01,
  IconSearchMd,
  IconTrash01,
  IconUploadCloud01,
  IconUsers01,
} from '@/components/icons';

import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { formatPercent } from '@/lib/format/format-number';
import { type UploadTask } from '../hooks/use-direct-upload';
import { type TypeFacet } from '../lib/file-types';

export function UploadProgressTiles({ tasks }: { tasks: UploadTask[] }) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Uploads in progress">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center gap-3 rounded-xl bg-alpha-6 px-3.5 py-2.5">
          <IconUploadCloud01 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-meta text-foreground">{task.filename}</span>
          {task.status === 'error' ? (
            <span className="text-meta text-destructive">Failed</span>
          ) : (
            <span className="flex w-28 items-center gap-2 sm:w-40">
              <Progress value={Math.round(task.progress * 100)} className="h-1.5" />
              <span className="w-9 text-right text-meta font-medium text-muted-foreground tabular">
                {task.status === 'syncing' ? '100%' : formatPercent(task.progress * 100, 0)}
              </span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function FilesEmptyState({
  searching,
  type,
  trash,
  insideFolder,
  teamRoot,
  uploadOffReason,
}: {
  searching: boolean;
  type: TypeFacet | null;
  trash: boolean;
  insideFolder: boolean;
  teamRoot: boolean;
  uploadOffReason: string | null;
}) {
  if (searching) {
    return <EmptyState icon={IconSearchMd} title="No files match that search" />;
  }
  if (teamRoot) {
    return <EmptyState icon={IconUsers01} title="Nothing shared yet" />;
  }
  if (trash) {
    return (
      <EmptyState
        icon={IconTrash01}
        title="Deleted files wait here for 30 days before they’re gone for good"
      />
    );
  }
  if (type === 'images') {
    return (
      <EmptyState
        icon={IconImage01}
        title="Images you upload and images your agent makes will show up here"
      />
    );
  }
  if (type !== null) {
    return <EmptyState icon={IconFile02} title="Files of this type will gather here as you go" />;
  }
  if (insideFolder) {
    return (
      <EmptyState
        icon={IconFile02}
        title={
          uploadOffReason === null
            ? 'Drop files here, or drag them anywhere on the page'
            : 'This folder is empty'
        }
        description={uploadOffReason ?? undefined}
      />
    );
  }
  return (
    <EmptyState
      icon={IconFile02}
      title={
        uploadOffReason === null
          ? 'Files you upload and files your agent makes all live here, drag one in to start'
          : 'Files your agent makes all live here'
      }
      description={uploadOffReason ?? undefined}
    />
  );
}

export const TYPE_FACET_LABELS: Record<TypeFacet, string> = {
  images: 'Images',
  documents: 'Documents',
  spreadsheets: 'Spreadsheets',
  presentations: 'Presentations',
  pdfs: 'PDFs',
};
