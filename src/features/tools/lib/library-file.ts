import { baseMime, fileExtension } from '@/features/files/lib/file-types';
import { basename, normalizeFolderPath, ROOT } from '@/features/files/lib/paths';

const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/javascript',
  'application/sql',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'image/svg+xml',
]);

export function isTextLikeMime(mimeType: string): boolean {
  const mime = baseMime(mimeType);
  return (
    mime.startsWith('text/') ||
    mime.endsWith('+json') ||
    mime.endsWith('+xml') ||
    TEXT_MIME_TYPES.has(mime)
  );
}

export function resolveLibraryItemPath(rawPath: string): { path: string; message?: string } {
  const path = normalizeFolderPath(rawPath);
  if (path === null || path === ROOT || basename(path) === '') {
    const displayPath = path ?? rawPath.trim();
    return { path: displayPath, message: `"${displayPath}" is not a valid Library item path.` };
  }
  return { path };
}

export function mimeForTextFilename(filename: string): string {
  const ext = fileExtension(filename);
  if (ext === 'json') return 'application/json';
  if (ext === 'md' || ext === 'markdown') return 'text/markdown';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'xml') return 'application/xml';
  if (ext === 'yaml' || ext === 'yml') return 'application/yaml';
  return 'text/plain';
}
