import { z } from 'zod';

export const EXA_SEARCH_CATEGORIES = [
  'company',
  'publication',
  'news',
  'personal site',
  'financial report',
  'people',
] as const;

const DEFAULT_NUM_RESULTS = 5;
export const MAX_SEARCH_RESULTS = 10;
export const MAX_SEARCH_QUERY_CHARS = 2000;
export const MAX_SEARCH_DOMAINS = 20;
export const MAX_SEARCH_DOMAIN_CHARS = 2048;
// The approved retrieval budget is 1,000 characters. Keep it named separately
// from the shorter text shown in the result card.
const DYNAMIC_HIGHLIGHT_TOTAL_CHARS = 1000;
const SNIPPET_CHARS = 240;

const publishedDate = z.iso.datetime({ offset: true });
const domains = z.array(z.string().min(1).max(MAX_SEARCH_DOMAIN_CHARS)).max(MAX_SEARCH_DOMAINS);

export const webSearchExaInputSchema = z
  .object({
    query: z.string().min(1).max(MAX_SEARCH_QUERY_CHARS),
    numResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
    category: z.enum(EXA_SEARCH_CATEGORIES).optional(),
    include_domains: domains.optional(),
    exclude_domains: domains.optional(),
    start_published_date: publishedDate.optional(),
    end_published_date: publishedDate.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.category !== 'company' && value.category !== 'people') return;
    for (const field of [
      'exclude_domains',
      'start_published_date',
      'end_published_date',
    ] as const) {
      if (value[field] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is not supported for the ${value.category} category`,
        });
      }
    }
  });

export type WebSearchExaInput = z.infer<typeof webSearchExaInputSchema>;

export function buildExaSearchRequest(input: WebSearchExaInput) {
  return {
    query: input.query,
    numResults: Math.min(input.numResults ?? DEFAULT_NUM_RESULTS, MAX_SEARCH_RESULTS),
    type: 'auto' as const,
    contents: {
      highlights: {
        query: input.query,
        dynamic: true,
        maxTotalCharacters: DYNAMIC_HIGHLIGHT_TOTAL_CHARS,
      },
    },
    ...(input.category ? { category: input.category } : {}),
    ...(input.include_domains ? { includeDomains: input.include_domains } : {}),
    ...(input.exclude_domains ? { excludeDomains: input.exclude_domains } : {}),
    ...(input.start_published_date ? { startPublishedDate: input.start_published_date } : {}),
    ...(input.end_published_date ? { endPublishedDate: input.end_published_date } : {}),
  };
}

// Searches request highlights, so only highlights populate the result snippet.
export function snippetFromExaResult(source: { highlights?: string[] | null }): string {
  const clean = (source.highlights ?? []).join(' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= SNIPPET_CHARS) return clean;
  return `${clean.slice(0, SNIPPET_CHARS).trimEnd()}…`;
}
