'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ActionState } from '@/lib/action-state';
import { captureException } from '@/lib/observability-client';
import { cleanupPreviousProfileImage, uploadProfileImage } from '../lib/client-upload';
import { profileUploadReducer } from '../lib/profile-upload-machine';

export function useProfileUpload(input: {
  kind: 'avatar' | 'workspace-icon';
  onOpenChange: (open: boolean) => void;
  onUploaded: (url: string) => Promise<ActionState>;
}) {
  const { onOpenChange } = input;
  const [state, dispatch] = useReducer(profileUploadReducer, { kind: 'idle' });
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrl = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef<symbol | null>(null);
  const revokePreview = useCallback(() => {
    if (objectUrl.current !== null) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);
  useEffect(
    () => () => {
      attempt.current = null;
      revokePreview();
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [revokePreview],
  );
  const handleOpenChange = useCallback(
    (next: boolean) => {
      // Saving commits the image before returning its URL; every close path waits for that outcome.
      if (attempt.current !== null) return;
      if (!next) {
        revokePreview();
        if (timer.current !== null) clearTimeout(timer.current);
        dispatch({ type: 'reset' });
        setDragActive(false);
      }
      onOpenChange(next);
    },
    [onOpenChange, revokePreview],
  );
  function acceptFile(file: File) {
    if (attempt.current !== null) return;
    revokePreview();
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      dispatch({ type: 'invalid', message: 'Choose a PNG, JPG, WEBP or GIF image' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      dispatch({ type: 'invalid', message: 'That image is over the 5MB limit' });
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    objectUrl.current = previewUrl;
    dispatch({ type: 'select', file, previewUrl });
  }
  async function handleSave() {
    if (state.kind !== 'ready' || attempt.current !== null) return;
    const token = Symbol();
    attempt.current = token;
    dispatch({ type: 'start', attempt: token });
    try {
      const url = await uploadProfileImage({
        file: state.file,
        kind: input.kind,
        onProgress: (progress) => dispatch({ type: 'progress', attempt: token, progress }),
      });
      if (attempt.current !== token) {
        await cleanupPreviousProfileImage(input.kind, url);
        return;
      }
      const saved = await input.onUploaded(url);
      if (attempt.current !== token) return;
      if (!saved.ok) {
        await cleanupPreviousProfileImage(input.kind, url);
        toast.error(
          input.kind === 'avatar'
            ? 'Couldn’t save your avatar. Try again.'
            : 'Couldn’t save the workspace icon. Try again.',
          { description: saved.message },
        );
        dispatch({ type: 'failed', attempt: token });
        return;
      }
      dispatch({ type: 'saved', attempt: token });
      timer.current = setTimeout(() => handleOpenChange(false), 900);
    } catch (cause) {
      if (attempt.current !== token) return;
      captureException(cause, { op: 'profile-image.upload', kind: input.kind });
      toast.error(
        input.kind === 'avatar'
          ? 'Couldn’t upload your avatar. Try again.'
          : 'Couldn’t upload the workspace icon. Try again.',
      );
      dispatch({ type: 'failed', attempt: token });
    } finally {
      if (attempt.current === token) attempt.current = null;
    }
  }
  return {
    state,
    inputRef,
    drag: { dragActive, setDragActive },
    events: {
      handleOpenChange,
      handleSave,
      onPick: (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) acceptFile(file);
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        setDragActive(false);
        const file = event.dataTransfer.files.item(0);
        if (file) acceptFile(file);
      },
    },
  };
}
