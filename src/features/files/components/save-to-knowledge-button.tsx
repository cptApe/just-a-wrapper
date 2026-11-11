'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { IconBookmark, IconBookmarkCheck } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AppError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import type { ArtifactSummary } from '../types';

// The server owns the saved link; deleting its Library file makes the artifact saveable again.

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'error' };

function useSaveToKnowledge(
  artifact: ArtifactSummary,
  onSaved: (artifactId: string, savedDriveFileId: string) => void,
): { state: SaveState; save: () => Promise<void> } {
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  async function save() {
    setState({ kind: 'saving' });
    try {
      const body: unknown = await fetchJson(`/api/artifacts/${artifact.id}/save`, {
        method: 'POST',
      });
      const savedDriveFileId =
        typeof body === 'object' && body !== null && 'savedDriveFileId' in body
          ? body.savedDriveFileId
          : null;
      if (typeof savedDriveFileId !== 'string') {
        throw new AppError('UNEXPECTED', 'save response missing savedDriveFileId', {
          artifactId: artifact.id,
        });
      }
      setState({ kind: 'idle' });
      onSaved(artifact.id, savedDriveFileId);
    } catch (error) {
      captureException(error, { artifactId: artifact.id, op: 'save-to-knowledge' });
      // Storage turned off is a setting, not an outage; show its sentence.
      if (
        error instanceof AppError &&
        error.context.serverCode === 'INTEGRATION_NOT_CONNECTED' &&
        typeof error.context.serverMessage === 'string'
      ) {
        toast.error(error.context.serverMessage);
      }
      setState({ kind: 'error' });
    }
  }

  return { state, save };
}

export function SaveToKnowledgeButton({
  artifact,
  onSaved,
  compact = false,
  className,
}: {
  artifact: ArtifactSummary;
  /** Lift the new drive file id so list state flips the card to "Saved". */
  onSaved: (artifactId: string, savedDriveFileId: string) => void;
  /** Short "Save" label for tight card rows; the panel uses the full label. */
  compact?: boolean;
  className?: string;
}) {
  const { state, save } = useSaveToKnowledge(artifact, onSaved);

  if (artifact.savedDriveFileId) {
    return (
      <span
        className="inline-flex h-8 items-center gap-1.5 px-2 text-meta font-medium text-muted-foreground"
        title="Saved to Library"
      >
        <IconBookmarkCheck className="size-3.5" />
        {compact ? 'Saved' : 'Saved to Library'}
      </span>
    );
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      className={className}
      onClick={save}
      disabled={state.kind === 'saving'}
      aria-label={`Save ${artifact.filename} to Library`}
    >
      {state.kind === 'saving' ? (
        <Spinner className="size-3.5" />
      ) : (
        <IconBookmark className="size-3.5" />
      )}
      {state.kind === 'error'
        ? compact
          ? 'Retry'
          : 'Retry save'
        : compact
          ? 'Save'
          : 'Save to Library'}
    </Button>
  );
}
