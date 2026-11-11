// A cross-origin download attribute cannot force attachment disposition; the signed Blob URL must.
export function downloadUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}download=1`;
}
