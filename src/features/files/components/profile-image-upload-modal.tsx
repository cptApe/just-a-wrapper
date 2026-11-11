'use client';

import { IconAlertCircle, IconCheckCircle, IconUploadCloud02 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import type { ActionState } from '@/lib/action-state';
import { cn } from '@/lib/utils';
import { useProfileUpload } from '../hooks/use-profile-upload';
import type { ProfileUploadState as State } from '../lib/profile-upload-machine';

const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,image/gif';

const LABELS = {
  avatar: { title: 'Change avatar', noun: 'avatar', done: 'Avatar updated' },
  'workspace-icon': {
    title: 'Change workspace icon',
    noun: 'workspace icon',
    done: 'Workspace icon updated',
  },
} as const;

type ProfileImageKind = keyof typeof LABELS;

export function ProfileImageUploadModal({
  kind,
  open,
  onOpenChange,
  onUploaded,
}: {
  kind: ProfileImageKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (fileUrl: string) => Promise<ActionState>;
}) {
  const { state, inputRef, drag, events } = useProfileUpload({
    kind,
    onOpenChange,
    onUploaded,
  });
  const { dragActive, setDragActive } = drag;
  const { handleOpenChange, handleSave, onPick, onDrop } = events;

  const isUploading = state.kind === 'uploading';
  const canSave = state.kind === 'ready';

  return (
    <Modal open={open} onOpenChange={handleOpenChange} presentation="dialog" size="sm">
      <ModalHeader>
        <ModalTitle>{LABELS[kind].title}</ModalTitle>
      </ModalHeader>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) void handleSave();
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <UploadContent
          kind={kind}
          state={state}
          inputRef={inputRef}
          onPick={onPick}
          dragActive={dragActive}
          setDragActive={setDragActive}
          onDrop={onDrop}
        />
        <ModalFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!canSave || isUploading}>
            {isUploading ? <Spinner aria-hidden /> : null}
            {isUploading ? 'Uploading…' : 'Save'}
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}

function DropArea({
  dragActive,
  onBrowse,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  dragActive: boolean;
  onBrowse: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onBrowse}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 px-6 text-center',
        'transition-colors duration-150 ease-[var(--ease-out)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        dragActive ? 'border-ring bg-alpha-12' : 'border-alpha-16 hover:bg-alpha-6',
      )}
    >
      <IconUploadCloud02 className="size-8 text-muted-foreground" aria-hidden />
      <span className="text-body">
        Drag an image here, or{' '}
        <span className="font-medium underline underline-offset-2">browse</span>
      </span>
      <span className="text-meta text-muted-foreground">PNG, JPG, WEBP or GIF up to 5MB</span>
    </button>
  );
}

function UploadContent({
  kind,
  state,
  inputRef,
  onPick,
  dragActive,
  setDragActive,
  onDrop,
}: {
  kind: ProfileImageKind;
  state: State;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (event: React.ChangeEvent<HTMLInputElement>) => void;
  dragActive: boolean;
  setDragActive: (active: boolean) => void;
  onDrop: (event: React.DragEvent) => void;
}) {
  const isUploading = state.kind === 'uploading';
  const pickError = state.kind === 'error' ? state.message : null;
  const { noun, done } = LABELS[kind];
  return (
    <ModalContent className="gap-4">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={onPick}
        data-testid={`${kind}-file-input`}
      />

      {state.kind === 'idle' || state.kind === 'error' ? (
        <>
          <DropArea
            dragActive={dragActive}
            onBrowse={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
          />
          <div className="min-h-5">
            {pickError ? (
              <p role="alert" className="flex items-center gap-1.5 text-meta text-destructive">
                <IconAlertCircle className="size-4 shrink-0" aria-hidden />
                {pickError}
              </p>
            ) : null}
          </div>
        </>
      ) : state.kind === 'success' ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <IconCheckCircle className="size-10 text-success" aria-hidden />
          <p className="text-body font-medium">{done}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="relative size-28">
            {state.previewUrl ? (
              // Blob URLs cannot go through next/image, so the preview is a background image.
              <div
                role="img"
                aria-label={`Selected ${noun} preview`}
                className="size-28 rounded-full bg-cover bg-center"
                style={{ backgroundImage: `url(${state.previewUrl})` }}
              />
            ) : null}
            {isUploading ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-scrim">
                <Spinner className="size-6 text-on-media" aria-hidden />
              </div>
            ) : null}
          </div>

          {isUploading ? (
            <div
              className="h-1 w-40 overflow-hidden rounded-full bg-alpha-8"
              role="progressbar"
              aria-label={`Uploading ${noun}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(state.progress * 100)}
            >
              <div
                className="h-full origin-left rounded-full bg-foreground transition-transform duration-150 ease-[var(--ease-out)]"
                style={{ transform: `scaleX(${state.progress})` }}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-meta font-medium text-foreground underline-offset-2 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-sm"
            >
              Choose a different image
            </button>
          )}
        </div>
      )}
    </ModalContent>
  );
}
