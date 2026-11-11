'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { AppError } from '@/lib/errors';
import { fetchVoid } from '@/lib/fetch-json';
import { plural } from '@/lib/format/plural';
import { captureException } from '@/lib/observability-client';
import { uploadBrowserFile } from '../lib/client-upload';
import { ROOT } from '../lib/paths';
import { type UploadTask, uploadTaskReducer } from '../lib/upload-task-machine';
import type { UploadConfig } from '../types';

export type { UploadTask } from '../lib/upload-task-machine';
export type DroppedFile = {
  file: File;
  /** Folder path relative to the drop root ('' or 'sub/dir') — folder drags. */
  relativeDir: string;
};

function uploadFolder(folderPath: string, relativeDir: string): string {
  const dir = folderPath === ROOT ? '' : folderPath;
  const rel = relativeDir === '' ? '' : `/${relativeDir}`;
  return `${dir}${rel}` || '/';
}

/** Collect files (with relative dirs) from a drop — including dragged folders,
    via the webkitGetAsEntry directory-traversal API. */
export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<DroppedFile[]> {
  const out: DroppedFile[] = [];
  const entries: Array<{ entry: FileSystemEntry | null; file: File | null }> = Array.from(
    dataTransfer.items,
  )
    .filter((item) => item.kind === 'file')
    .map((item) => ({
      entry: typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null,
      file: item.getAsFile(),
    }));

  async function walk(entry: FileSystemEntry, dir: string): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      out.push({ file, relativeDir: dir });
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const childDir = dir === '' ? entry.name : `${dir}/${entry.name}`;
      // readEntries returns batches; keep reading until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, childDir);
      }
    }
  }

  for (const { entry, file } of entries) {
    if (entry) {
      if (entry.isDirectory) await walk(entry, '');
      else if (file) out.push({ file, relativeDir: '' });
    } else if (file) {
      out.push({ file, relativeDir: '' });
    }
  }
  return out;
}

export function useDirectUpload({
  config,
  workspaceId,
  folderPath,
  onUploaded,
  shareToken,
}: {
  shareToken: string | null;
  config: UploadConfig;
  workspaceId: string;
  /** Folder path (workspace-relative) uploads land in. */
  folderPath: string;
  /** Called once after a batch finishes with ≥1 success. */
  onUploaded?: () => void;
}): {
  enabled: boolean;
  tasks: UploadTask[];
  uploadFiles: (files: DroppedFile[]) => Promise<void>;
  /** Create a small text file (the Files tab's New → Note). */
  uploadText: (filename: string, content: string) => Promise<boolean>;
} {
  const [tasks, dispatch] = React.useReducer(uploadTaskReducer, []);

  const uploadOne = React.useCallback(
    async (dropped: DroppedFile): Promise<boolean> => {
      if (!config.enabled) return false;
      const id = crypto.randomUUID();
      dispatch({ type: 'start', id, filename: dropped.file.name });
      try {
        const metadata = await uploadBrowserFile({
          signal: undefined,
          file: dropped.file,
          workspaceId,
          folderPath: uploadFolder(folderPath, dropped.relativeDir),
          shareToken,
          uploadTag: config.uploadTag,
          maxFileBytes: config.maxFileBytes,
          onProgress: (progress) => dispatch({ type: 'progress', id, progress }),
        });
        dispatch({ type: 'sync', id });

        await fetchVoid('/api/files/sync-metadata', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...metadata, shareToken, uploadSource: 'library' }),
        });
        dispatch({ type: 'remove', id });
        return true;
      } catch (error) {
        const overLimit = error instanceof AppError && error.code === 'PLAN_LIMIT_REACHED';
        if (!overLimit) captureException(error, { op: 'files-direct-upload' });
        dispatch({ type: 'fail', id });
        window.setTimeout(() => dispatch({ type: 'remove', id }), 4000);
        toast.error('Upload failed', {
          description: overLimit ? error.message : dropped.file.name,
        });
        return false;
      }
    },
    [config, workspaceId, folderPath, shareToken],
  );

  const uploadFiles = React.useCallback(
    async (files: DroppedFile[]) => {
      if (files.length === 0) return;
      const results = await Promise.all(files.map(uploadOne));
      const synced = results.filter(Boolean).length;
      if (synced > 0) {
        toast.success(`${plural(synced, 'file')} uploaded`);
        onUploaded?.();
      }
    },
    [uploadOne, onUploaded],
  );

  const uploadText = React.useCallback(
    async (filename: string, content: string) => {
      const file = new File([content], filename, { type: 'text/markdown' });
      const ok = await uploadOne({ file, relativeDir: '' });
      if (ok) onUploaded?.();
      return ok;
    },
    [uploadOne, onUploaded],
  );

  return { enabled: config.enabled, tasks, uploadFiles, uploadText };
}
