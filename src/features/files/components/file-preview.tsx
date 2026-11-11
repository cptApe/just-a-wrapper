'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { IconDownload01 } from '@/components/icons';
import { useOrganizationId } from '@/components/providers/app-providers';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { BinaryOfficePreview } from '@/features/files/components/binary-office-preview';
import { PreviewNotice } from '@/features/files/components/preview-notice';
import { TextFileContent, type TextFileKind } from '@/features/files/components/text-file-content';
import { ZoomableImage } from '@/features/files/components/zoomable-image';
import { classifyArtifact, MAX_TEXT_PREVIEW_BYTES } from '@/features/files/lib/artifact-kind';
import { findPdfSidecar } from '@/features/files/lib/pdf-sidecar';
import { formatBytes } from '@/lib/format/format-bytes';
import { fileQueryKeys } from '../api/keys';
import { useFileText } from '../hooks/use-file-text';
import { downloadUrl } from '../lib/download-url';
import type { FileEntry } from '../types';

// pdf.js is heavy and client-only — load it (and its worker) on demand so it
// stays out of the main bundle and only downloads when a PDF is previewed.
const PdfPreview = dynamic(() => import('./pdf-preview').then((m) => m.PdfPreview), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[200px] items-center justify-center" aria-busy="true">
      <Spinner className="size-5 text-muted-foreground" aria-hidden />
    </div>
  ),
});

// Drive previews reuse artifact classification and renderers with CDN content URLs.
// Import client renderers directly because the files barrel exposes server APIs.

export function FilePreview({
  file,
  siblings = [],
}: {
  file: FileEntry;
  siblings?: readonly FileEntry[];
}) {
  const kind = classifyArtifact(file.mimeType, file.filename);
  const organizationId = useOrganizationId();

  switch (kind) {
    case 'image':
      return <ImageFilePreview file={file} />;

    case 'pdf':
      return (
        // Keyed by url so a same-id row whose url is re-signed remounts cleanly
        // (fresh loading state + empty canvas) instead of flashing the stale doc.
        <PdfPreview
          key={file.url}
          filename={file.filename}
          url={file.url}
          fallback={
            <PreviewNotice
              title="Couldn’t load this PDF"
              message="The document could not be displayed. Download the file to view it."
              action={<DownloadFileLink file={file} />}
            />
          }
        />
      );

    case 'docx':
    case 'xlsx':
      return (
        <BinaryOfficePreview
          kind={kind}
          filename={file.filename}
          url={file.url}
          downloadHref={downloadUrl(file.url)}
          contentLengthBytes={file.sizeBytes}
          queryKey={
            organizationId === null
              ? fileQueryKeys.unscoped()
              : fileQueryKeys.text(organizationId, file.url)
          }
          enabled={organizationId !== null}
        />
      );

    case 'pptx': {
      const sidecar = findPdfSidecar(
        file.filename,
        siblings,
        (candidate) => candidate.folderPath === file.folderPath,
      );
      if (!sidecar) {
        return (
          <BinaryOfficePreview
            kind={kind}
            filename={file.filename}
            url={file.url}
            downloadHref={downloadUrl(file.url)}
            contentLengthBytes={file.sizeBytes}
            queryKey={
              organizationId === null
                ? fileQueryKeys.unscoped()
                : fileQueryKeys.text(organizationId, file.url)
            }
            enabled={organizationId !== null}
          />
        );
      }
      return (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex shrink-0 justify-end">
            <DownloadFileLink file={file} label="Download the deck" />
          </div>
          <div className="min-h-0 flex-1">
            <FilePreview file={sidecar} />
          </div>
        </div>
      );
    }
    case 'audio':
      return <AudioFilePreview file={file} />;

    case 'video':
      return <VideoFilePreview file={file} />;

    case 'markdown':
    case 'code':
    case 'csv':
    case 'html':
      if (file.sizeBytes > MAX_TEXT_PREVIEW_BYTES) {
        return (
          <PreviewNotice
            title="Too large to preview"
            message={`${formatBytes(file.sizeBytes)}. Download the file to view it.`}
            action={<DownloadFileLink file={file} />}
          />
        );
      }
      return <StoredFileTextPreview file={file} kind={kind} />;

    case 'unknown':
      return (
        <PreviewNotice
          title="No preview for this file type"
          message={`${file.mimeType || 'Unknown type'} · ${formatBytes(file.sizeBytes)}`}
          action={<DownloadFileLink file={file} />}
        />
      );
  }
}

function AudioFilePreview({ file }: { file: FileEntry }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <PreviewNotice
        title="Couldn’t load this audio"
        message="The audio could not be played. Download the file to listen to it."
        action={<DownloadFileLink file={file} />}
      />
    );
  }
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center px-4">
      {/* Generated audio has no separate captions track. */}
      <audio
        controls
        preload="metadata"
        src={file.url}
        className="w-full max-w-xl"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function VideoFilePreview({ file }: { file: FileEntry }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <PreviewNotice
        title="Couldn’t play this video"
        message="The video could not be played. Download the file to watch it."
        action={<DownloadFileLink file={file} />}
      />
    );
  }
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center">
      {/* Uploaded video has no separate captions track. */}
      <video
        key={file.url}
        controls
        playsInline
        preload="metadata"
        src={file.url}
        className="max-h-full w-full rounded-lg"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function ImageFilePreview({ file }: { file: FileEntry }) {
  return (
    <ZoomableImage
      key={`${file.id}:${file.url}`}
      src={file.url}
      alt={file.filename}
      fallback={
        <PreviewNotice
          title="Couldn’t load this image"
          message="The image could not be displayed. Download the file to view it."
          action={<DownloadFileLink file={file} />}
        />
      }
    />
  );
}

function StoredFileTextPreview({ file, kind }: { file: FileEntry; kind: TextFileKind }) {
  const state = useFileText(file.url);
  if (state.kind === 'loading') {
    return (
      <div
        className="flex h-full min-h-[200px] items-center justify-center"
        aria-busy="true"
        aria-label={`Loading ${file.filename}`}
      >
        <Spinner className="size-5 text-muted-foreground" aria-hidden />
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <PreviewNotice
        title="Couldn’t load the preview"
        message={state.message}
        action={<DownloadFileLink file={file} />}
      />
    );
  }
  const content = (
    <TextFileContent
      filename={file.filename}
      mimeType={file.mimeType}
      kind={kind}
      text={state.text}
    />
  );
  if (kind === 'html') return content;
  // The table draws its own rounded border, so it sits directly in the panel
  // instead of inside the paper card that markdown and code use.
  if (kind === 'csv') {
    return <div className="h-full overflow-y-auto">{content}</div>;
  }
  return <TextContentSurface>{content}</TextContentSurface>;
}

function TextContentSurface({ children }: { children: ReactNode }) {
  return (
    // Text reads better inside a light frame; a hairline border on the panel's
    // own ground, never a tinted card.
    <div className="h-full overflow-y-auto rounded-xl border p-5">{children}</div>
  );
}

function DownloadFileLink({ file, label = 'Download' }: { file: FileEntry; label?: string }) {
  return (
    <Button asChild variant="secondary" size="xs">
      <a href={downloadUrl(file.url)} download={file.filename}>
        <IconDownload01 className="size-3.5" />
        {label}
      </a>
    </Button>
  );
}
