import { z } from 'zod';

// The pure core of `fetch_page`: the Exa /contents request and response schemas and the projection
// to the tool's output rows. The handler in tools/custom-tools/fetch-page.ts adds the SSRF gate and
// the HTTP call.

const MAX_FETCH_URLS = 5;
const MAX_FETCH_URL_CHARS = 2048;
const MAX_FETCH_QUERY_CHARS = 500;
export const MAX_SUBPAGE_TARGET_CHARS = 100;
export const MAX_FETCH_SUBPAGES = 10;
// 'full' mode page-text cap — parity with browse_page's reading pane.
const FULL_TEXT_CHARS = 10_000;
// 'brief' mode dynamic-highlight budget across the whole request.
const HIGHLIGHT_CHARS = 1_000;
const MAX_AGE_HOURS = 24;
const EXCLUDED_FULL_TEXT_SECTIONS = ['navigation', 'banner', 'sidebar', 'footer'] as const;
// A blocked crawl can return a stub of a few hundred characters. Below this
// boundary, the page read is too small to trust as representative content.
const THIN_CONTENT_CHARS = 500;

const THIN_CONTENT_NOTE = '(thin content — page likely needs a real browser; try browse_page)';
const CACHED_CONTENT_NOTE = '(served from Exa cache)';

const subpageTarget = z.string().min(1).max(MAX_SUBPAGE_TARGET_CHARS);

export const FetchPageInputSchema = z.object({
  urls: z.array(z.string().url().max(MAX_FETCH_URL_CHARS)).min(1).max(MAX_FETCH_URLS),
  query: z.string().min(1).max(MAX_FETCH_QUERY_CHARS).optional(),
  mode: z.enum(['brief', 'full']).optional(),
  subpages: z.number().int().min(0).max(MAX_FETCH_SUBPAGES).optional(),
  subpage_target: z.union([subpageTarget, z.array(subpageTarget).min(1)]).optional(),
});
export type FetchPageInput = z.infer<typeof FetchPageInputSchema>;

export function buildExaContentsRequest(input: FetchPageInput) {
  const contents =
    input.mode === 'full'
      ? {
          text: {
            maxCharacters: FULL_TEXT_CHARS,
            excludeSections: EXCLUDED_FULL_TEXT_SECTIONS,
          },
        }
      : {
          summary: input.query ? { query: input.query } : {},
          highlights: {
            ...(input.query ? { query: input.query } : {}),
            dynamic: true,
            maxTotalCharacters: HIGHLIGHT_CHARS,
          },
        };

  return {
    urls: input.urls,
    maxAgeHours: MAX_AGE_HOURS,
    ...contents,
    ...(input.subpages !== undefined ? { subpages: input.subpages } : {}),
    ...(input.subpage_target !== undefined ? { subpageTarget: input.subpage_target } : {}),
  };
}

const fetchedPage = z.object({
  url: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  highlights: z.array(z.string()).optional(),
  text: z.string().optional(),
  /** Agent-facing quality signal for thin or cached content. */
  note: z.string().optional(),
  /** True when 'full' text hit the cap and was clipped by Exa. */
  truncated: z.boolean().optional(),
});
export const FetchPageOutputSchema = z.object({
  pages: z.array(fetchedPage),
  failed: z.array(z.object({ url: z.string(), reason: z.string() })),
  /** Real vendor cost of this call in CENTS — the dispatcher bills it. */
  vendorCostCents: z.number(),
});
export type FetchPageOutput = z.infer<typeof FetchPageOutputSchema>;

// Tolerate missing Exa title/summary fields. Nested subpages inherit the root
// crawl’s cache provenance because statuses cover roots only. Ignore highlightScores.
const exaPageContent = z.object({
  url: z.string(),
  title: z.string().nullish(),
  text: z.string().nullish(),
  summary: z.string().nullish(),
  highlights: z.array(z.string()).nullish(),
});
const exaResult = exaPageContent.extend({
  subpages: z.array(exaPageContent).nullish(),
});
const exaStatus = z.object({
  id: z.string(),
  status: z.string(),
  error: z.object({ tag: z.string().nullish() }).nullish(),
  source: z.enum(['cached', 'crawled']).optional(),
});
export const ExaContentsResponseSchema = z.object({
  results: z.array(exaResult),
  statuses: z.array(exaStatus).optional(),
});
export type ExaContentsResponse = z.infer<typeof ExaContentsResponseSchema>;

/** Project a parsed /contents response onto the tool's output rows. */
export function toFetchPageOutput(
  parsed: ExaContentsResponse,
  mode: FetchPageInput['mode'],
  vendorCostCents: number,
): FetchPageOutput {
  const statusesByUrl = new Map((parsed.statuses ?? []).map((status) => [status.id, status]));

  return {
    pages: parsed.results.map((r) => {
      const contentChars = [r.text, r.summary, ...(r.highlights ?? [])]
        .filter((value): value is string => typeof value === 'string')
        .join('')
        .trim().length;
      const notes = [
        ...(contentChars < THIN_CONTENT_CHARS ? [THIN_CONTENT_NOTE] : []),
        ...(mode === 'full' && statusesByUrl.get(r.url)?.source === 'cached'
          ? [CACHED_CONTENT_NOTE]
          : []),
      ];
      const source = statusesByUrl.get(r.url)?.source;
      const subpageSections = (r.subpages ?? []).map((subpage) => {
        const subpageContent = [
          subpage.text,
          subpage.summary,
          ...(subpage.highlights ?? []),
        ].filter((value): value is string => typeof value === 'string' && value.length > 0);
        const subpageChars = subpageContent.join('').trim().length;
        const subpageNotes = [
          ...(subpageChars < THIN_CONTENT_CHARS ? [THIN_CONTENT_NOTE] : []),
          ...(mode === 'full' && source === 'cached' ? [CACHED_CONTENT_NOTE] : []),
        ];

        return [
          `— from ${subpage.url}`,
          ...(subpageNotes.length ? [subpageNotes.join(' ')] : []),
          ...subpageContent,
        ].join('\n');
      });
      const foldedText = [r.text, ...subpageSections]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join('\n\n');
      const truncated =
        mode === 'full' &&
        [r, ...(r.subpages ?? [])].some((page) => (page.text?.length ?? 0) >= FULL_TEXT_CHARS);

      return {
        url: r.url,
        title: r.title?.trim() || r.url,
        ...(r.summary ? { summary: r.summary } : {}),
        ...(r.highlights?.length ? { highlights: r.highlights } : {}),
        ...(foldedText ? { text: foldedText } : {}),
        ...(notes.length ? { note: notes.join(' ') } : {}),
        ...(truncated ? { truncated: true } : {}),
      };
    }),
    failed: (parsed.statuses ?? [])
      .filter((s) => s.status !== 'success')
      .map((s) => ({ url: s.id, reason: s.error?.tag || s.status })),
    vendorCostCents,
  };
}
