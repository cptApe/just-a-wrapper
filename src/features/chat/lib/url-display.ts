// Small pure helpers for showing URLs in the thread. Kept here (not re-declared
// per renderer) so the web-ability cards phrase hosts identically.

/** A URL's host reads better than the full address on a card ("example.com").
 * Falls back to the raw string when it isn't a parseable URL. */
export function hostLabel(url: string): string {
  if (!URL.canParse(url)) return url;
  return new URL(url).host.replace(/^www\./, '');
}
