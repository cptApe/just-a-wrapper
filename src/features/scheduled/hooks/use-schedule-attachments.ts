'use client';
import * as React from 'react';
import {
  type AttachContext,
  type PendingAttachment,
  releasePendingAttachment,
  uploadFilesToLibrary,
} from '@/features/chat/lib/attachments';
import type { ComposerLibraryFile, ComposerLibraryFolder } from '@/features/sessions/types';
import type { TaskAttachments } from '@/features/tasks/types';
import { AppError } from '@/lib/errors';
import { useScheduleUploadConfig } from '../api/use-schedule-upload-config';
import {
  type ScheduleAttachmentsState,
  scheduleAttachmentsReducer,
} from '../lib/schedule-attachments-machine';

export function useScheduleAttachments(initial: TaskAttachments | null) {
  const [state, dispatch] = React.useReducer(scheduleAttachmentsReducer, {
    kind: 'ready',
    pending: [],
    files: initial?.files ?? [],
    folders: initial?.folders ?? [],
  } satisfies ScheduleAttachmentsState);
  const { pending, files: libraryPicks, folders: folderPicks } = state;
  const setPending = (value: React.SetStateAction<PendingAttachment[]>) =>
    dispatch({ type: 'pending', value });
  const setLibraryPicks = (value: React.SetStateAction<ComposerLibraryFile[]>) =>
    dispatch({ type: 'files', value });
  const setFolderPicks = (value: React.SetStateAction<ComposerLibraryFolder[]>) =>
    dispatch({ type: 'folders', value });
  const [attachOpen, setAttachOpen] = React.useState(false);
  const [attachNonce, setAttachNonce] = React.useState(0);
  const uploading = state.kind === 'uploading';
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const attachQuery = useScheduleUploadConfig();
  const attach: AttachContext | null = attachQuery.data
    ? { workspaceId: attachQuery.data.workspaceId, uploadConfig: attachQuery.data.uploadConfig }
    : null;
  const attachEnabled = attach?.uploadConfig.enabled === true;
  const removePending = (id: string) =>
    setPending((prev) => {
      const gone = prev.find((item) => item.id === id);
      if (gone) releasePendingAttachment(gone);
      return prev.filter((item) => item.id !== id);
    });

  const upload = async () => {
    if (state.kind === 'uploading')
      throw new AppError('CONFLICT', 'Attachments are already uploading', {});
    const attempt = crypto.randomUUID();
    dispatch({ type: 'begin', attempt });
    const files = [...libraryPicks];
    const failures = [];
    try {
      for (const pendingFile of pending) {
        const outcome = await uploadFilesToLibrary([pendingFile], attach, undefined);
        failures.push(...outcome.failed);
        if (outcome.failed.length > 0) continue;
        files.push(...outcome.files);
        dispatch({ type: 'uploaded', attempt, pendingId: pendingFile.id, files: outcome.files });
        releasePendingAttachment(pendingFile);
      }
      if (failures.length > 0) {
        throw new AppError(
          'API_REQUEST_FAILED',
          `Couldn’t attach ${failures.map((file) => file.name).join(', ')}.`,
          {
            description: failures[0]?.message,
            failures,
            expectedState: failures.every((failure) =>
              [
                'INVALID_BODY',
                'VALIDATION_FAILED',
                'TOOL_INPUT_INVALID',
                'PLAN_LIMIT_REACHED',
                'CREDITS_EXHAUSTED',
                'INTEGRATION_NOT_CONNECTED',
              ].includes(failure.code),
            ),
          },
        );
      }
      dispatch({ type: 'finish', attempt, failed: false });
    } catch (error) {
      dispatch({ type: 'finish', attempt, failed: true });
      throw error;
    }
    const attachments: TaskAttachments | null =
      files.length > 0 || folderPicks.length > 0 ? { files, folders: folderPicks } : null;
    return attachments;
  };
  return {
    selection: {
      pending,
      removePending,
      libraryPicks,
      setLibraryPicks,
      folderPicks,
      setFolderPicks,
      setPending,
    },
    picker: {
      attachEnabled,
      attach,
      fileInputRef,
      setAttachNonce,
      setAttachOpen,
      attachOpen,
      attachNonce,
    },
    uploading,
    upload,
  };
}
