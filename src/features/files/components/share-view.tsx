'use client';

import { useRouter } from 'next/navigation';
import { IconFolder } from '@/components/icons';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { EmptyState } from '@/components/ui/empty-state';
import { formatBytes } from '@/lib/format/format-bytes';
import { formatDate } from '@/lib/format/format-date';
import type { FileEntry, ShareMode, UploadConfig } from '../types';
import { FileKindIcon } from './file-kind-icon';
import { UploadArea } from './upload-area';

// Public folder-share surface rendered at /share/[token]. Always shows the file
// list; shows the upload widget only when mode='edit'. Branded with the workspace
// name. The page (RSC) has already resolved liveness — this just renders.

export function ShareView({
  workspaceName,
  workspaceId,
  folderPath,
  mode,
  files,
  token,
  uploadConfig,
}: {
  workspaceName: string;
  workspaceId: string;
  folderPath: string;
  mode: ShareMode;
  files: FileEntry[];
  token: string;
  uploadConfig: UploadConfig;
}) {
  const router = useRouter();
  // A public page has no signed-in reader, so dates read in UTC on the server and in the browser.
  const { timeZone } = useDisplayFormat();
  const folderLabel = folderPath === '/' ? 'Shared files' : folderPath.slice(1);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[840px] flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1.5 border-b pb-5">
        <p className="text-meta font-medium text-muted-foreground">{workspaceName}</p>
        <h1 className="flex items-center gap-2 text-title-section font-semibold">
          <IconFolder className="size-5" /> {folderLabel}
        </h1>
        <p className="text-meta text-muted-foreground">
          {mode === 'edit'
            ? 'You can view, download, and upload files in this folder.'
            : 'You can view and download files in this folder.'}
        </p>
      </header>

      {mode === 'edit' && (
        <section className="flex flex-col gap-2">
          <UploadArea
            config={uploadConfig}
            workspaceId={workspaceId}
            folderPath={folderPath}
            shareToken={token}
            onUploaded={() => router.refresh()}
          />
        </section>
      )}

      {files.length === 0 ? (
        <EmptyState
          icon={IconFolder}
          title="No files yet"
          description={mode === 'edit' ? 'Upload a file to get started' : 'This folder is empty'}
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {files.map((file) => (
            <li key={file.id}>
              <a
                href={file.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 px-4 py-3 hover:bg-alpha-6"
              >
                <FileKindIcon mimeType={file.mimeType} name={file.filename} className="size-5" />
                <span className="flex-1 truncate text-meta font-medium" title={file.filename}>
                  {file.filename}
                </span>
                <span className="shrink-0 text-meta font-medium text-muted-foreground">
                  {formatBytes(file.sizeBytes)} · {formatDate(file.createdAt, timeZone)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
