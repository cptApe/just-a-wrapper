import 'server-only';
import { z } from 'zod';
import { IntegrationError } from '@/lib/errors';
import { proxyCallTool } from '../mcp-proxy-client';

// Create connect links through the member’s Tool Router session so OAuth and
// action execution resolve the same auth config. Read per-toolkit results from
// the meta-tool text JSON; initiated results carry redirect_url.

export type ToolkitConnection = { status: 'active' } | { status: 'pending'; redirectUrl: string };

// Per-toolkit entry in a BATCH read: the connection state, or an `error` when this
// one toolkit's result was missing/uninterpretable — so a single bad entry can't
// blank the whole page (the single-toolkit {@link toolkitConnection} keeps its
// throwing contract for the connect / refresh actions instead).
export type ToolkitConnectionEntry = ToolkitConnection | { status: 'error'; message: string };

const connectionResultSchema = z.object({
  status: z.string().nullish(),
  redirect_url: z.string().nullish(),
  redirectUrl: z.string().nullish(),
});
const manageConnectionsSchema = z.object({
  data: z.object({ results: z.record(z.string(), z.unknown()).nullish() }).nullish(),
  error: z.unknown().optional(),
});
const textBlockSchema = z.object({ type: z.literal('text'), text: z.string() });
type ManageConnectionsPayload = z.infer<typeof manageConnectionsSchema>;

function parseTextBlocks(content: unknown): ManageConnectionsPayload {
  if (!Array.isArray(content)) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'MANAGE_CONNECTIONS returned no content', {
      contentType: typeof content,
    });
  }
  const text = content
    .flatMap((block: unknown) => {
      const parsed = textBlockSchema.safeParse(block);
      return parsed.success ? [parsed.data.text] : [];
    })
    .join('');
  try {
    return manageConnectionsSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'MANAGE_CONNECTIONS returned invalid JSON payload',
      { sample: text.slice(0, 200) },
      { cause: error },
    );
  }
}

// A malformed toolkit must not hide healthy connections in the same batch.
function interpretResult(toolkitSlug: string, value: unknown): ToolkitConnectionEntry {
  const parsed = connectionResultSchema.safeParse(value);
  if (!parsed.success) {
    return { status: 'error', message: `Invalid connection result for ${toolkitSlug}` };
  }
  const result = parsed.data;
  const status = (result.status ?? '').toLowerCase();
  if (status === 'active') {
    return { status: 'active' };
  }
  const redirectUrl = result.redirect_url ?? result.redirectUrl;
  if (redirectUrl) {
    return { status: 'pending', redirectUrl };
  }
  return {
    status: 'error',
    message: `MANAGE_CONNECTIONS returned no active connection or connect link (status: ${
      result.status ?? 'unknown'
    })`,
  };
}

export async function toolkitConnection(
  proxyUrl: string,
  memberJwt: string,
  toolkitSlug: string,
): Promise<ToolkitConnection> {
  const content = await proxyCallTool(proxyUrl, memberJwt, 'COMPOSIO_MANAGE_CONNECTIONS', {
    toolkits: [toolkitSlug],
  });
  const payload = parseTextBlocks(content);
  const entry = interpretResult(toolkitSlug, payload.data?.results?.[toolkitSlug]);
  if (entry.status === 'error') {
    throw new IntegrationError('EXTERNAL_API_FAILED', entry.message, {
      toolkitSlug,
      keys: Object.keys(payload.data?.results ?? {}),
    });
  }
  return entry;
}

/** Read all toolkit connection states in one MANAGE_CONNECTIONS call.
 * Keep per-toolkit errors isolated; throw only for transport or parse failures. */
export async function toolkitConnections(
  proxyUrl: string,
  memberJwt: string,
  toolkitSlugs: string[],
): Promise<Map<string, ToolkitConnectionEntry>> {
  const content = await proxyCallTool(proxyUrl, memberJwt, 'COMPOSIO_MANAGE_CONNECTIONS', {
    toolkits: toolkitSlugs,
  });
  const results = parseTextBlocks(content).data?.results ?? {};
  return new Map(toolkitSlugs.map((slug) => [slug, interpretResult(slug, results[slug])]));
}
