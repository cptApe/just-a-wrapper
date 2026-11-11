'use client';
import { upload } from '@vercel/blob/client';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import { formatBytes } from '@/lib/format/format-bytes';
import { captureException } from '@/lib/observability-client';
import { storagePathFor } from './paths';

export async function uploadBrowserFile(input: {
  file: File;
  workspaceId: string;
  folderPath: string;
  uploadTag: string;
  maxFileBytes: number;
  shareToken: string | null;
  onProgress: ((progress: number) => void) | null;
  signal: AbortSignal | undefined;
}) {
  // Blob enforces the same ceiling but answers with a bare rejection the person cannot act on.
  if (input.file.size > input.maxFileBytes) {
    throw new AppError(
      'PLAN_LIMIT_REACHED',
      `${input.file.name} is over this workspace’s ${formatBytes(input.maxFileBytes)} file limit. Choose a smaller file.`,
      { expectedState: true },
    );
  }
  const pathname = storagePathFor(
    input.workspaceId,
    input.folderPath,
    `${input.uploadTag}-${crypto.randomUUID()}-${input.file.name}`,
  );
  const blob = await upload(pathname, input.file, {
    abortSignal: input.signal,
    access: 'private',
    contentType: input.file.type || 'application/octet-stream',
    handleUploadUrl: `/api/files/upload-token${input.shareToken ? `?share=${encodeURIComponent(input.shareToken)}` : ''}`,
    onUploadProgress: ({ percentage }) => input.onProgress?.(percentage / 100),
  });
  return {
    storagePath: blob.pathname,
    originalFileName: input.file.name,
  };
}

export async function uploadProfileImage(input: {
  file: File;
  kind: 'avatar' | 'workspace-icon';
  onProgress: (progress: number) => void;
}): Promise<string> {
  const prepared = z.object({ pathname: z.string() }).parse(
    await fetchJson('/api/files/profile-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'prepare', kind: input.kind }),
    }),
  );
  await upload(prepared.pathname, input.file, {
    access: 'private',
    contentType: input.file.type,
    handleUploadUrl: `/api/files/upload-token?profile=${input.kind}`,
    onUploadProgress: ({ percentage }) => input.onProgress(percentage / 100),
  });
  const saved = z.object({ url: z.string() }).parse(
    await fetchJson('/api/files/profile-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'save', kind: input.kind, pathname: prepared.pathname }),
    }),
  );
  return saved.url;
}

// Failed cleanup remains retryable; the daily sweep also removes unreferenced profile images.
export async function cleanupPreviousProfileImage(
  kind: 'avatar' | 'workspace-icon',
  previousUrl: string | null,
): Promise<void> {
  if (!previousUrl) return;
  try {
    await fetchJson('/api/files/profile-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cleanup', kind, previousUrl }),
    });
  } catch (cause) {
    // The daily sweep retries unreferenced images; a published profile remains saved.
    captureException(cause, { operation: 'profile-image-cleanup', kind });
  }
}
