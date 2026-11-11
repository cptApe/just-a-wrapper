import { fileThumbnailUrl, parseFileContentUrl } from '@/lib/file-content-url';

// Private thumbnails share the original file's access check and share token.
export function thumbnailUrl(url: string): string {
  const parsed = parseFileContentUrl(url);
  return parsed ? fileThumbnailUrl(parsed.fileId, parsed.shareToken) : url;
}
