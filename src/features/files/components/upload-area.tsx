'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { IconUploadCloud01 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { formatPercent } from '@/lib/format/format-number';
import { collectDroppedFiles, useDirectUpload } from '../hooks/use-direct-upload';
import type { UploadConfig } from '../types';

type UploadAreaProps = {
  config: UploadConfig;
  workspaceId: string;
  folderPath: string;
  shareToken: string | null;
  onUploaded?: () => void;
};

export function UploadArea(props: UploadAreaProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const direct = useDirectUpload(props);
  useEffect(() => {
    if (!props.config.enabled) return;
    const enter = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
    };
  }, [props.config.enabled]);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void direct.uploadFiles(files.map((file) => ({ file, relativeDir: '' })));
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!direct.enabled}
        onClick={() => inputRef.current?.click()}
      >
        <IconUploadCloud01 className="size-4" />
        Upload
      </Button>
      {props.config.enabled ? null : (
        <p className="text-meta text-muted-foreground">{props.config.reason}</p>
      )}
      {dragging && (
        <div
          className="fixed inset-0 z-dialog flex items-center justify-center bg-background/70 p-8 backdrop-blur-sm"
          onDragOver={(event) => event.preventDefault()}
          onDrop={async (event) => {
            event.preventDefault();
            setDragging(false);
            if (
              props.shareToken !== null &&
              Array.from(event.dataTransfer.items).some(
                (item) => item.webkitGetAsEntry()?.isDirectory,
              )
            )
              toast.error(
                'Folders cannot be uploaded through a share link. Drop individual files instead.',
              );
            const dropped = await collectDroppedFiles(event.dataTransfer);
            await direct.uploadFiles(
              props.shareToken === null
                ? dropped
                : dropped.filter((entry) => entry.relativeDir === ''),
            );
          }}
        >
          <div className="rounded-xl border-2 border-dashed border-ring bg-background p-8">
            {props.shareToken === null ? 'Drop files or folders to upload' : 'Drop files to upload'}
          </div>
        </div>
      )}
      {direct.tasks.map((task) => (
        <div key={task.id} role="status" className="text-meta">
          {task.filename}:{' '}
          {task.status === 'error' ? 'Upload failed' : formatPercent(task.progress * 100, 0)}
        </div>
      ))}
    </>
  );
}
