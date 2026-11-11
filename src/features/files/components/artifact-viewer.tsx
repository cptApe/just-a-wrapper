'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { IconDownload01, IconFileQuestion01, IconLock01 } from '@/components/icons';
import { useOrganizationId } from '@/components/providers/app-providers';
import { formatBytes } from '@/lib/format/format-bytes';
import { artifactQueryKeys } from '../api/keys';
import { useArtifactText } from '../hooks/use-artifact-text';
import { classifyArtifact, MAX_TEXT_PREVIEW_BYTES } from '../lib/artifact-kind';
import { artifactContentUrl } from '../lib/content-url';
import { findPdfSidecar } from '../lib/pdf-sidecar';
import type { ArtifactSummary } from '../types';
import { BinaryOfficePreview } from './binary-office-preview';
import { PreviewNotice } from './preview-notice';
import { TextFileContent, type TextFileKind } from './text-file-content';
import { ZoomableImage } from './zoomable-image';

// THE artifact rendering system — one component, keyed by viewer kind, that
// every surface (chat side panel, /knowledge/artifacts, future canvases)
// mounts. Adding a kind = extend classifyArtifact + add a branch here; the
// mounting surfaces never change.
//
//   markdown → MarkdownMessage (the chat's Streamdown pipeline)
//   code     → the same pipeline through a safe Shiki fence
//   image    → <img> via the byte proxy (SVG included — no script execution)
//   audio    → native <audio controls> via the byte proxy
//   pdf      → pdf.js canvas viewer
//   csv      → capped table preview
//   html     → sandboxed iframe (html-preview.tsx — see its threat model)
//   docx     → mammoth-rendered document preview
//   xlsx     → capped workbook table preview
//   pptx     → matching pdf.js sidecar, else the slide renderer
//   unknown  → download-only card

const PdfPreview = dynamic(
  () => import('@/features/files/components/pdf-preview').then((module) => module.PdfPreview),
  { ssr: false },
);

export function ArtifactViewer({
  artifact,
  siblings = [],
}: {
  artifact: ArtifactSummary;
  siblings?: readonly ArtifactSummary[];
}) {
  const kind = classifyArtifact(artifact.mimeType, artifact.filename);
  const organizationId = useOrganizationId();

  if (!artifact.downloadable) {
    return (
      <ViewerNotice
        icon={<IconLock01 className="size-5" />}
        title="No preview available"
        message="The Files API doesn’t serve this file’s content, so it can’t be previewed or downloaded."
      />
    );
  }

  switch (kind) {
    case 'image':
      return (
        <ZoomableImage
          key={artifact.id}
          src={artifactContentUrl(artifact.id)}
          alt={artifact.filename}
          fallback={
            <PreviewNotice
              title="Couldn’t load this image"
              message="Download the file to view it."
              action={<DownloadLink artifact={artifact} />}
            />
          }
        />
      );

    case 'pdf':
      return (
        <PdfPreview
          filename={artifact.filename}
          url={artifactContentUrl(artifact.id)}
          fallback={
            <ViewerNotice
              icon={<IconFileQuestion01 className="size-5" />}
              title="PDF preview unavailable"
              message="The document could not be displayed. Download the file to view it."
              action={<DownloadLink artifact={artifact} />}
            />
          }
        />
      );

    case 'audio':
      return <AudioArtifactView artifact={artifact} />;

    case 'video':
      return <VideoArtifactView artifact={artifact} />;

    case 'markdown':
    case 'code':
    case 'csv':
    case 'html':
      return <TextArtifactView artifact={artifact} kind={kind} />;

    case 'docx':
    case 'xlsx':
      return (
        <BinaryOfficePreview
          kind={kind}
          filename={artifact.filename}
          url={artifactContentUrl(artifact.id)}
          downloadHref={artifactContentUrl(artifact.id, { download: true })}
          contentLengthBytes={artifact.sizeBytes}
          queryKey={
            organizationId === null
              ? artifactQueryKeys.unscoped()
              : artifactQueryKeys.text(organizationId, artifact.id)
          }
          enabled={organizationId !== null}
        />
      );

    case 'pptx': {
      const sidecar = findPdfSidecar(
        artifact.filename,
        siblings,
        (candidate) => candidate.downloadable,
      );
      if (!sidecar) {
        return (
          <BinaryOfficePreview
            kind={kind}
            filename={artifact.filename}
            url={artifactContentUrl(artifact.id)}
            downloadHref={artifactContentUrl(artifact.id, { download: true })}
            contentLengthBytes={artifact.sizeBytes}
            queryKey={
              organizationId === null
                ? artifactQueryKeys.unscoped()
                : artifactQueryKeys.text(organizationId, artifact.id)
            }
            enabled={organizationId !== null}
          />
        );
      }
      return (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex shrink-0 justify-end">
            <DownloadLink artifact={artifact} label="Download the deck" />
          </div>
          <div className="min-h-0 flex-1">
            <ArtifactViewer artifact={sidecar} />
          </div>
        </div>
      );
    }

    case 'unknown':
      return (
        <ViewerNotice
          icon={<IconFileQuestion01 className="size-5" />}
          title="No preview for this file type"
          message={`${artifact.mimeType || 'Unknown type'} · ${formatBytes(artifact.sizeBytes)}`}
          action={<DownloadLink artifact={artifact} />}
        />
      );
  }
}

function AudioArtifactView({ artifact }: { artifact: ArtifactSummary }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <ViewerNotice
        icon={<IconFileQuestion01 className="size-5" />}
        title="Audio preview unavailable"
        message="The audio could not be played. Download the file to listen to it."
        action={<DownloadLink artifact={artifact} />}
      />
    );
  }
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center px-4">
      {/* Generated audio has no separate captions track. */}
      <audio
        controls
        preload="metadata"
        src={artifactContentUrl(artifact.id)}
        className="w-full max-w-xl"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function VideoArtifactView({ artifact }: { artifact: ArtifactSummary }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <ViewerNotice
        icon={<IconFileQuestion01 className="size-5" />}
        title="Video preview unavailable"
        message="The video could not be played. Download the file to watch it."
        action={<DownloadLink artifact={artifact} />}
      />
    );
  }
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center">
      {/* Generated video has no separate captions track. */}
      <video
        controls
        playsInline
        preload="metadata"
        src={artifactContentUrl(artifact.id)}
        className="max-h-full w-full rounded-lg"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function TextArtifactView({ artifact, kind }: { artifact: ArtifactSummary; kind: TextFileKind }) {
  if (artifact.sizeBytes > MAX_TEXT_PREVIEW_BYTES) {
    return (
      <ViewerNotice
        icon={<IconFileQuestion01 className="size-5" />}
        title="Too large to preview"
        message={`${formatBytes(artifact.sizeBytes)}. Download the file to view it.`}
        action={<DownloadLink artifact={artifact} />}
      />
    );
  }
  return <LoadedTextView artifact={artifact} kind={kind} />;
}

function LoadedTextView({ artifact, kind }: { artifact: ArtifactSummary; kind: TextFileKind }) {
  const state = useArtifactText(artifact.id);
  if (state.kind === 'loading') {
    return (
      <div
        className="flex h-full min-h-[200px] items-center justify-center"
        aria-busy="true"
        aria-label={`Loading ${artifact.filename}`}
      >
        <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <ViewerNotice
        icon={<IconFileQuestion01 className="size-5" />}
        title="Couldn’t load the preview"
        message={state.message}
        action={<DownloadLink artifact={artifact} />}
      />
    );
  }
  const content = (
    <TextFileContent
      filename={artifact.filename}
      mimeType={artifact.mimeType}
      kind={kind}
      text={state.text}
    />
  );
  return kind === 'markdown' || kind === 'code' ? (
    <div className="overflow-y-auto overscroll-contain">{content}</div>
  ) : (
    content
  );
}

function ViewerNotice({
  icon,
  title,
  message,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-title-card font-semibold">{title}</p>
      <p className="max-w-sm text-meta text-muted-foreground">{message}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

function DownloadLink({
  artifact,
  label = 'Download',
}: {
  artifact: ArtifactSummary;
  label?: string;
}) {
  return (
    <a
      href={artifactContentUrl(artifact.id, { download: true })}
      download={artifact.filename}
      className="inline-flex h-8 items-center gap-1.5 rounded-button px-3 text-meta font-medium text-foreground shadow-[inset_0_0_0_1px_var(--color-alpha-16)] hover:bg-alpha-6"
    >
      <IconDownload01 className="size-3.5" />
      {label}
    </a>
  );
}
