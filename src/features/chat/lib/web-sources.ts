import { hostLabel } from './url-display';

export type WebSource = { host: string; url: string; title: string };

/** One entry per distinct host; the first result for a host represents it.
 *  Pure, and it drops blank urls the same way the line's host
 *  count does, so the line's count and the chips can never disagree. */
export function webSourcesOf(results: ReadonlyArray<{ url: string; title: string }>): WebSource[] {
  const sources: WebSource[] = [];
  for (const result of results) {
    if (result.url.trim().length === 0) continue;
    const host = hostLabel(result.url);
    if (!host || sources.some((source) => source.host === host)) continue;
    sources.push({ host, url: result.url, title: result.title });
  }
  return sources;
}
