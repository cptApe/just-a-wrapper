export type PreparedAttachment = {
  fileId: string;
  anthropicFileId: string;
  name: string;
  durableUrl: string;
  mountedPath: string;
};

type CachedAttachment =
  | { kind: 'mounted'; attachment: PreparedAttachment }
  | { kind: 'persisted'; fileId: string };

// File objects survive the composer's Home restore even though their transient
// PendingAttachment wrappers receive new ids. The weak association therefore
// carries the durable Library identity across a retry without retaining bytes.
const fileIdByBrowserFile = new WeakMap<object, string>();
const mountedBySessionAndFile = new Map<string, Map<string, PreparedAttachment>>();

export function findCachedAttachment(file: object, sessionId: string): CachedAttachment | null {
  const fileId = fileIdByBrowserFile.get(file);
  if (!fileId) return null;
  const mounted = mountedBySessionAndFile.get(sessionId)?.get(fileId);
  return mounted ? { kind: 'mounted', attachment: mounted } : { kind: 'persisted', fileId };
}

export function rememberCachedAttachment(
  file: object,
  sessionId: string,
  attachment: PreparedAttachment,
): void {
  fileIdByBrowserFile.set(file, attachment.fileId);
  const sessionMounts = mountedBySessionAndFile.get(sessionId) ?? new Map();
  sessionMounts.set(attachment.fileId, attachment);
  mountedBySessionAndFile.set(sessionId, sessionMounts);
}

/** Drop session-scoped mounts; weak browser-file identities expire naturally. */
export function clearMountedAttachmentsForSession(sessionId: string): void {
  mountedBySessionAndFile.delete(sessionId);
}

/** Keep the durable identity when Home uploads before it creates a session. */
export function rememberPersistedAttachment(file: object, fileId: string): void {
  fileIdByBrowserFile.set(file, fileId);
}
