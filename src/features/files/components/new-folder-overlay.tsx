'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
// Type-only import — erased at compile time, so the registry→overlay→registry
// module loop never exists at runtime.
import type { OverlayComponentProps } from '@/features/overlays';
import { createFolder } from '../api/folders';
import { ROOT } from '../lib/paths';
import { NameDialog } from './name-dialog';

// The new-folder overlay reads its target from hash path, defaulting to root.
// Call the shared createFolder action with server-resolved workspace access,
// then refresh the Library to show the result.

export function NewFolderOverlay({ open, params, onClose }: OverlayComponentProps) {
  const router = useRouter();
  const path = params.get('path') ?? ROOT;
  const submission = useMutation({
    mutationFn: (name: string) => createFolder(path, name),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error('Action failed', { description: res.message });
        return;
      }
      toast.success('Folder created');
      onClose();
      router.refresh();
    },
    onError: (error) => {
      toast.error('Action failed', { description: error.message });
    },
  });

  return (
    <NameDialog
      open={open}
      title="New folder"
      label="Folder name"
      submitLabel="Create"
      busy={submission.isPending}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onSubmit={(name) => submission.mutate(name)}
    />
  );
}
