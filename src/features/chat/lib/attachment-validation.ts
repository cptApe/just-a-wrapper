export function partitionComposerFiles(files: Iterable<File>): {
  attachable: File[];
  empty: File[];
} {
  const list = Array.from(files);
  return {
    attachable: list.filter((file) => file.size > 0),
    empty: list.filter((file) => file.size === 0),
  };
}

/** An armed send waits through failures until the failed pick is retried or removed. */
export function attachmentSendGate(
  attachments: ReadonlyArray<{ status?: 'local' | 'uploading' | 'ready' | 'failed' }>,
): 'ready' | 'uploading' | 'failed' {
  if (attachments.some((attachment) => attachment.status === 'uploading')) return 'uploading';
  if (attachments.some((attachment) => attachment.status === 'failed')) return 'failed';
  return 'ready';
}
