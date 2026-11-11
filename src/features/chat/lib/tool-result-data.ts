// Tolerant readers for structured tool results. Custom tools post their output
// back as JSON text (the dispatcher serializes the validated output object);
// these helpers let a renderer read that structure without ever throwing on
// the malformed case — a result that doesn't parse simply renders as text.

import type { z } from 'zod';
import { recordOf } from './record-of';
import {
  browsedPageSchema,
  exaSearchSchema,
  fetchedPageFailureSchema,
  fetchedPageSchema,
  fetchedPagesSchema,
  libraryListingSchema,
  screenshotSchema,
  webSearchSchema,
} from './tool-result-schemas';

import { hostLabel } from './url-display';
import { webSourcesOf } from './web-sources';

// Renderers call this during render, so parses are memoized per exact result
// text: a malformed payload reports its breadcrumb once, not on every
// re-render of the card that holds it. Result texts are immutable once
// settled, so a small FIFO cache is safe.
const parseCache = new Map<string, unknown>();
const PARSE_CACHE_MAX = 50;

export function parseResultObject(text: string): Record<string, unknown> | null {
  const parsed = parseResultValue(text);
  return recordOf(parsed);
}

/** Parse an object or array result while keeping malformed and plain text tolerant. */
export function parseResultValue(text: string): Record<string, unknown> | unknown[] | null {
  const cached = parseCache.get(text);
  if (cached !== undefined) return containerValue(cached);
  const parsed = parseValueOnce(text);
  if (parseCache.size >= PARSE_CACHE_MAX) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== undefined) parseCache.delete(oldest);
  }
  parseCache.set(text, parsed);
  return containerValue(parsed);
}

function containerValue(value: unknown): Record<string, unknown> | unknown[] | null {
  return Array.isArray(value) ? value : recordOf(value);
}

function parseValueOnce(text: string): unknown {
  const trimmed = text.trim();
  // Plain-text results are a legitimate shape, not an error. Structured tool
  // results in this module are objects or arrays, so only those claim JSON.
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    // Malformed tool results render verbatim, so decoding never hides a response.
    if (typeof window !== 'undefined') {
      // Lazy import keeps these readers usable under the Node test runner.
      void import('@/lib/observability-client').then((module) =>
        module.captureException(error, { feature: 'chat', op: 'parse-tool-result' }),
      );
    }
    return null;
  }
}

function readWebSearchResults(text: string) {
  const parsed = webSearchSchema.safeParse(parseResultValue(text));
  return parsed.success ? parsed.data : null;
}

/** Distinct chip sources for a successful native search. Null is the explicit
 *  signal that details must use the visible default fallback. */
export function webSearchSources(
  result: { isError: boolean; text: string } | undefined,
): ReturnType<typeof webSourcesOf> | null {
  if (!result || result.isError) return null;
  const results = readWebSearchResults(result.text);
  return results ? webSourcesOf(results) : null;
}

export function readLibraryListing(text: string) {
  const parsed = libraryListingSchema.safeParse(parseResultObject(text));
  return parsed.success ? parsed.data : null;
}

export function readExaSearchResults(text: string) {
  const parsed = exaSearchSchema.safeParse(parseResultObject(text));
  return parsed.success ? parsed.data : null;
}

/** The first distinct website returned by either search tool, once a successful
 *  result has settled. This is the single result-aware source for line favicons. */
export function firstSearchResultHost(
  toolName: string,
  result: { isError: boolean; text: string } | undefined,
): string | undefined {
  if (!result || result.isError) return undefined;
  if (toolName === 'web_search') return webSearchSources(result)?.[0]?.host;
  const results =
    toolName === 'web_search_exa' ? readExaSearchResults(result.text)?.results : undefined;
  return results ? webSourcesOf(results)[0]?.host : undefined;
}

export type PageScreenshot = z.infer<typeof screenshotSchema>;

// A malformed snapshot still leaves the page's readable text available.
export function readBrowsedPage(text: string) {
  const parsed = browsedPageSchema.safeParse(parseResultObject(text));
  return parsed.success ? parsed.data : null;
}

type FetchedPage = {
  url: string;
  title: string;
  /** One line of context for the row: a summary or the first highlight. */
  summary?: string;
  firstHighlight?: string;
};

type FetchedPageFailure = { url: string; reason: string };

type FetchedPages = { pages: FetchedPage[]; failed: FetchedPageFailure[] };

/** Distinct input websites for a multi-page fetch, or null when the single-page
 * detail renderer should stay in use. Parsed page titles enrich chip tooltips;
 * an exact URL wins, then a same-host canonical result. */
export function fetchedPageSources(
  inputUrls: readonly string[],
  data: FetchedPages,
): ReturnType<typeof webSourcesOf> | null {
  if (inputUrls.length <= 1) return null;
  return webSourcesOf(
    inputUrls.map((url) => {
      const inputHost = hostLabel(url);
      const page =
        data.pages.find((candidate) => candidate.url === url) ??
        data.pages.find((candidate) => hostLabel(candidate.url) === inputHost);
      return { url, title: page?.title ?? inputHost };
    }),
  );
}

/** Read a `fetch_page` result; null when the shape doesn't match. Mirrors
    FetchPageOutputSchema (src/features/tool-catalog/lib/exa-contents.ts): pages carry a
    url + title with optional summary/highlights, and failed rows carry a url +
    reason. Malformed entries drop out rather than rejecting the whole result. */
export function readFetchedPages(text: string): FetchedPages | null {
  const parsed = fetchedPagesSchema.safeParse(parseResultObject(text));
  if (!parsed.success) return null;
  const pages = parsed.data.pages.flatMap((value) => {
    const parsedPage = fetchedPageSchema.safeParse(value);
    if (!parsedPage.success) return [];
    const { url, title, summary, highlights } = parsedPage.data;
    const firstHighlight = highlights?.at(0);
    return [
      {
        url,
        title,
        ...(summary ? { summary } : {}),
        ...(typeof firstHighlight === 'string' && firstHighlight ? { firstHighlight } : {}),
      },
    ];
  });
  const failed = parsed.data.failed.flatMap((value) => {
    const failure = fetchedPageFailureSchema.safeParse(value);
    return failure.success ? [failure.data] : [];
  });
  return { pages, failed };
}
