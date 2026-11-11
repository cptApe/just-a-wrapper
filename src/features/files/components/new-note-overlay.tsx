'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
// Type-only import — erased at compile time, so the registry→overlay→registry
// module loop never exists at runtime.
import type { OverlayComponentProps } from '@/features/overlays';
import { captureException } from '@/lib/observability-client';
import { fileQueryKeys } from '../api/keys';
import { getUploadContext } from '../api/upload-context';
import { useDirectUpload } from '../hooks/use-direct-upload';
import { ROOT } from '../lib/paths';
import type { UploadConfig } from '../types';
import { NewNoteDialog } from './new-note-dialog';

// The new-note overlay resolves upload context and uses useDirectUpload.
// Hash path selects the folder, defaulting to root; upload completion refreshes Library.
// Keep the hook mounted with disabled config during loading and hold Submit
// until the real workspace upload configuration arrives.
const LOADING_CONFIG: UploadConfig = { enabled: false, reason: 'Preparing upload' };

export function NewNoteOverlay({ open, params, onClose }: OverlayComponentProps) {
  const router = useRouter();
  const path = params.get('path') ?? ROOT;
  const organizationId = useOrganizationId();
  const query = useQuery({
    queryKey:
      organizationId === null
        ? fileQueryKeys.unscoped()
        : fileQueryKeys.uploadContext(organizationId),
    queryFn: getUploadContext,
    enabled: open && organizationId !== null,
  });
  const context = query.data;
  React.useEffect(() => {
    if (!query.isError) return;
    captureException(query.error, { op: 'new-note.upload-context' });
    toast.error('Couldn’t start a note here. Please try again.');
    onClose();
  }, [query.isError, query.error, onClose]);

  const direct = useDirectUpload({
    shareToken: null,
    config: context?.config ?? LOADING_CONFIG,
    workspaceId: context?.workspaceId ?? '',
    folderPath: path,
    onUploaded: () => router.refresh(),
  });

  const submission = useMutation({
    mutationFn: async ({ name, content }: { name: string; content: string }) => {
      const filename = name.toLowerCase().endsWith('.md') ? name : `${name}.md`;
      if (await direct.uploadText(filename, content)) onClose();
    },
  });

  return (
    <NewNoteDialog
      open={open}
      busy={submission.isPending || context === undefined}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onSubmit={async (name, content) => {
        await submission.mutateAsync({ name, content });
      }}
    />
  );
}
