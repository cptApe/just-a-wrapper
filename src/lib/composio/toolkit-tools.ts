import 'server-only';
import { z } from 'zod';
import { IntegrationError } from '@/lib/errors';
import { COMPOSIO_API_BASE } from './api';

// Soft TTL for cached toolkit catalog entries; a re-read is one upstream GET.
const TOOLKIT_CATALOG_TTL_MS = 1000 * 60 * 60 * 24;

// Read per-toolkit actions from the REST catalog, not session tools/list meta-tools.
// Catalog slugs match executor input and key permission rows.
// Resolve exact tool, read/write wildcard, toolkit wildcard, then session mode;
// a connected-app wildcard allow covers reads only.

type ToolkitToolEntry = {
  slug: string;
  name: string;
  description: string;
  tags: string[];
};

export type ToolkitToolsList = {
  tools: ToolkitToolEntry[];
  /** Catalog total reported by Composio. */
  totalCount: number;
};

const TOOLS_PATH = '/api/v3.1/tools';
const PAGE_LIMIT = 50;
// Fetch the complete catalogue so connect-time exact permission rows cover all
// actions. Twenty pages allows large toolkits such as GitHub while a continuing
// cursor at the ceiling fails visibly instead of silently omitting actions.
const MAX_PAGES = 20;

type CacheEntry = { at: number; value: ToolkitToolsList };
const cache = new Map<string, CacheEntry>();

// Catalog descriptions are optional display copy; malformed entries cannot name an action.
const toolSchema = z.object({
  slug: z.string().min(1),
  name: z.string().catch(''),
  description: z.string().catch(''),
  tags: z
    .array(z.unknown())
    .catch([])
    .transform((tags) =>
      tags.flatMap((tag) => {
        const parsed = z.string().safeParse(tag);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});
const toolsPageSchema = z.object({
  items: z.array(z.unknown()).nullish(),
  next_cursor: z.string().nullish(),
  total_items: z.number().nullish(),
});

/**
 * List one toolkit's complete action catalogue, with a defensive page ceiling.
 * Successful reads are cached in-process (same TTL discipline as the logo
 * catalog); failures are not cached, so the next request retries.
 */
export async function listToolkitTools(slug: string, apiKey: string): Promise<ToolkitToolsList> {
  const now = Date.now();
  const cached = cache.get(slug);
  if (cached && now - cached.at < TOOLKIT_CATALOG_TTL_MS) {
    return cached.value;
  }

  const tools: ToolkitToolEntry[] = [];
  let totalCount = 0;
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await readToolkitToolsPage(slug, apiKey, cursor);
    totalCount = body.total_items ?? totalCount;
    for (const entry of body.items ?? []) {
      const tool = toolSchema.safeParse(entry);
      if (tool.success) tools.push(tool.data);
    }
    cursor = body.next_cursor || null;
    if (!cursor) break;
  }

  if (cursor) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Composio tools catalog exceeded page limit',
      {
        toolkitSlug: slug,
        maxPages: MAX_PAGES,
        pageLimit: PAGE_LIMIT,
      },
    );
  }

  const value: ToolkitToolsList = { tools, totalCount: Math.max(totalCount, tools.length) };
  cache.set(slug, { at: now, value });
  return value;
}

async function readToolkitToolsPage(slug: string, apiKey: string, cursor: string | null) {
  const params = new URLSearchParams({ toolkit_slug: slug, limit: String(PAGE_LIMIT) });
  if (cursor) params.set('cursor', cursor);
  const response = await fetch(`${COMPOSIO_API_BASE}${TOOLS_PATH}?${params}`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!response.ok) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Composio tools catalog read failed', {
      toolkitSlug: slug,
      status: response.status,
    });
  }
  const parsed = toolsPageSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Composio tools catalog response is invalid',
      { toolkitSlug: slug },
      { cause: parsed.error },
    );
  }
  return parsed.data;
}
