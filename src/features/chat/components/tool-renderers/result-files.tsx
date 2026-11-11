'use client';

import { InlineImage } from '@/components/ui/inline-image';
import { classifyArtifact } from '@/features/files/lib/artifact-kind';
import type { ArtifactSummary } from '@/features/files/types';
import { openOverlay } from '@/features/overlays';
import type { ToolResult } from '../../lib/chat-state';
import {
  type ChatFileTarget,
  chatSessionIdFromPath,
  openAction,
  primaryAction,
} from '../../lib/file-link';
import { FileCard } from '../file-card';

// Files a settled tool result referenced, inside the tool's card: an image
// renders as itself, everything else as the shared file card. A card
// opens the task panel when the artifact is known on a task route, downloads
// when only the bytes are reachable, and stays plain when neither is.

function artifactSrc(artifact: ArtifactSummary): string {
  return `/api/artifacts/${artifact.id}/content`;
}

function currentSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  return chatSessionIdFromPath(window.location.pathname);
}

export function ResultFiles({
  result,
  artifactsByFileId,
}: {
  result: ToolResult;
  artifactsByFileId?: ReadonlyMap<string, ArtifactSummary>;
}) {
  const refs = result.fileRefs ?? [];
  if (refs.length === 0) return null;
  const sessionId = currentSessionId();

  return (
    <div className="flex flex-col gap-2" data-testid="result-files">
      {refs.map((ref) => {
        const artifact = artifactsByFileId?.get(ref.fileId);
        const target: ChatFileTarget | null = artifact
          ? { kind: 'artifact', artifact, sessionId }
          : null;
        const isImage =
          ref.blockType === 'image' ||
          (artifact !== undefined &&
            classifyArtifact(artifact.mimeType, artifact.filename) === 'image');
        if (isImage && artifact && target) {
          const open = openAction(target);
          return (
            <InlineImage
              key={ref.fileId}
              src={artifactSrc(artifact)}
              alt={artifact.filename}
              onOpen={open ? () => openOverlay(open.hash) : undefined}
              testId="result-image"
            />
          );
        }
        return (
          <FileCard
            key={ref.fileId}
            name={artifact ? artifact.filename : (ref.title ?? (isImage ? 'Image' : 'File'))}
            mimeType={artifact?.mimeType ?? (isImage ? 'image/unknown' : '')}
            action={target ? primaryAction(target) : null}
            testId="result-file"
          />
        );
      })}
    </div>
  );
}
