export const FILE_CONTENT_PATH =
  /^\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/content(?:\?[^#]*)?$/i;

export function parseFileContentUrl(
  url: string,
): { fileId: string; shareToken: string | null } | null {
  const match = FILE_CONTENT_PATH.exec(url);
  const fileId = match?.[1];
  if (!fileId) return null;
  return { fileId, shareToken: new URL(url, 'https://files.invalid').searchParams.get('share') };
}

export function fileContentUrl(fileId: string, shareToken: string | null): string {
  const path = `/api/files/${encodeURIComponent(fileId)}/content`;
  return shareToken ? `${path}?share=${encodeURIComponent(shareToken)}` : path;
}

export function fileThumbnailUrl(fileId: string, shareToken: string | null): string {
  const path = `/api/files/${encodeURIComponent(fileId)}/thumbnail`;
  return shareToken ? `${path}?share=${encodeURIComponent(shareToken)}` : path;
}
