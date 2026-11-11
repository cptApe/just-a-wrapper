'use client';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { ComposerAttachCanvas } from '@/features/chat/components/composer-attach-canvas';
import { ComposerAttachMenu } from '@/features/chat/components/composer-attach-menu';
import { ComposerAttachments } from '@/features/chat/components/composer-attachments';
import { partitionComposerFiles } from '@/features/chat/lib/attachment-validation';
import { createPendingAttachment } from '@/features/chat/lib/attachments';
import type { useScheduleAttachments } from '../hooks/use-schedule-attachments';
export function SchedulePromptFrame({
  attachments,
  children,
  tierSelect,
}: {
  attachments: ReturnType<typeof useScheduleAttachments>;
  children: ReactNode;
  tierSelect: ReactNode;
}) {
  const {
    pending,
    removePending,
    libraryPicks,
    setLibraryPicks,
    folderPicks,
    setFolderPicks,
    setPending,
  } = attachments.selection;
  const {
    attachEnabled,
    attach,
    fileInputRef,
    setAttachNonce,
    setAttachOpen,
    attachOpen,
    attachNonce,
  } = attachments.picker;
  return (
    <>
      <div className="flex flex-col rounded-md bg-alpha-6 transition-[box-shadow] duration-150 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background">
        <ComposerAttachments
          attachments={pending}
          onRemove={removePending}
          libraryFiles={libraryPicks}
          onRemoveLibraryFile={(id) =>
            setLibraryPicks((prev) => prev.filter((file) => file.id !== id))
          }
          libraryFolders={folderPicks}
          onRemoveLibraryFolder={(path) =>
            setFolderPicks((prev) => prev.filter((folder) => folder.path !== path))
          }
        />
        {children}
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex items-center gap-1">
            <ComposerAttachMenu
              disabled={!attachEnabled}
              disabledReason={
                attach && !attach.uploadConfig.enabled ? attach.uploadConfig.reason : null
              }
              onPickFromComputer={() => fileInputRef.current?.click()}
              onOpenLibrary={() => {
                setAttachNonce((n) => n + 1);
                setAttachOpen(true);
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const { attachable, empty } = partitionComposerFiles(event.target.files ?? []);
                if (empty.length > 0)
                  toast.error(`Skipped empty files: ${empty.map((file) => file.name).join(', ')}`);
                setPending((prev) => [...prev, ...attachable.map(createPendingAttachment)]);
                event.target.value = '';
              }}
            />
          </div>
          {tierSelect}
        </div>
      </div>
      <ComposerAttachCanvas
        mode="library"
        open={attachOpen}
        openNonce={attachNonce}
        onClose={() => setAttachOpen(false)}
        onConfirmLibrary={(picks) => {
          setLibraryPicks((prev) => [
            ...prev,
            ...picks.files.filter((file) => !prev.some((p) => p.id === file.id)),
          ]);
          setFolderPicks((prev) => [
            ...prev,
            ...picks.folders.filter((folder) => !prev.some((p) => p.path === folder.path)),
          ]);
          setAttachOpen(false);
        }}
        onConfirmSkills={() => setAttachOpen(false)}
        skillSelectedIds={[]}
      />
    </>
  );
}
