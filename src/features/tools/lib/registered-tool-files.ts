export const SESSION_FILE_LIMIT = 100;
const SESSION_UPLOAD_PREFIX = '/mnt/session/uploads/';

export type ToolFileContext = {
  workspaceId: string;
  userId: string;
  sessionId: string;
  sessionRowId: string;
};

export type ToolFileReference = {
  libraryPath?: string;
  name?: string;
  outputFilename?: string;
  url?: string;
};

type ReadableSource =
  | { kind: 'bytes'; bytes: Uint8Array<ArrayBuffer> }
  | { kind: 'url'; url: string }
  | { kind: 'blob'; storagePath: string; fileId: string };

export type ResolvedToolFile = {
  foundIn: 'library' | 'chat_attachment' | 'session_output' | 'tool_output' | 'url';
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  id?: string;
  libraryPath?: string;
  sessionArtifactId?: string;
  source: ReadableSource;
};

export function attachmentName(reference: string): string {
  return reference.startsWith(SESSION_UPLOAD_PREFIX)
    ? reference.slice(SESSION_UPLOAD_PREFIX.length)
    : reference;
}

export function latestKind(reference: string): string | null {
  const match = /\blatest\s+(image|audio|video|document|file)\b/i.exec(reference.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

export function matchesFileKind(mimeType: string, kind: string | null): boolean {
  if (kind === null || kind === 'file') return true;
  if (kind === 'document') {
    return (
      !mimeType.startsWith('image/') &&
      !mimeType.startsWith('audio/') &&
      !mimeType.startsWith('video/')
    );
  }
  return mimeType.startsWith(`${kind}/`);
}
