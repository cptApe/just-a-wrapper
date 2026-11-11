import { z } from 'zod';
import { lenientOptional } from './lenient-optional';

export const webSearchSchema = z
  .array(
    z.object({
      type: z.literal('search_result'),
      source: z.string(),
      title: z.string(),
    }),
  )
  .transform((rows) => rows.map((row) => ({ title: row.title, url: row.source })));

export const libraryListingSchema = z.object({
  path: z.string(),
  entries: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      kind: z.enum(['file', 'folder']),
      size: lenientOptional(z.number()),
    }),
  ),
  message: lenientOptional(z.string()),
});

export const exaSearchSchema = z.object({
  query: z.string(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
      publishedDate: lenientOptional(z.string()),
    }),
  ),
});

export const screenshotSchema = z.object({
  url: z.string().min(1),
  width: z.number(),
  height: z.number(),
});
export const browsedPageSchema = z
  .object({
    url: z.string(),
    title: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    screenshot: lenientOptional(screenshotSchema),
    browserbaseSessionId: lenientOptional(z.string().min(1)),
  })
  .transform(({ screenshot, browserbaseSessionId, ...page }) => ({
    ...page,
    ...(screenshot ? { screenshot } : {}),
    ...(browserbaseSessionId ? { browserbaseSessionId } : {}),
  }));

export const fetchedPagesSchema = z.object({
  pages: z.array(z.unknown()),
  failed: z.array(z.unknown()),
});
export const fetchedPageSchema = z.object({
  url: z.string(),
  title: z.string(),
  summary: lenientOptional(z.string().min(1)),
  highlights: lenientOptional(z.array(z.unknown())),
});
export const fetchedPageFailureSchema = z.object({ url: z.string(), reason: z.string() });
