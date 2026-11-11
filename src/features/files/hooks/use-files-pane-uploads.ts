import * as React from 'react';
import { toast } from 'sonner';
import type { UploadConfig } from '../types';
import { collectDroppedFiles, useDirectUpload } from './use-direct-upload';

export function useFilesPaneUploads({
  uploadConfig,
  workspaceId,
  path,
  trash,
  refreshLibrary,
}: {
  uploadConfig: UploadConfig;
  workspaceId: string;
  path: string;
  trash: boolean;
  refreshLibrary: () => void;
}) {
  const direct = useDirectUpload({
    shareToken: null,
    config: uploadConfig,
    workspaceId,
    folderPath: path,
    onUploaded: refreshLibrary,
  });
  const [dragging, setDragging] = React.useState(false);
  React.useEffect(() => {
    if (trash) return undefined;
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
    };
  }, [trash]);

  const offReason = uploadConfig.enabled ? null : uploadConfig.reason;
  return {
    tasks: direct.tasks,
    dragging,
    offReason,
    pickFiles: (files: File[]) =>
      direct.uploadFiles(files.map((file) => ({ file, relativeDir: '' }))),
    /** Uploads files and folders dropped anywhere on the pane, or says why uploads are off. */
    drop: (dataTransfer: DataTransfer) => {
      setDragging(false);
      if (offReason !== null) {
        toast.error(offReason);
        return;
      }
      void collectDroppedFiles(dataTransfer).then((dropped) => direct.uploadFiles(dropped));
    },
  };
}
