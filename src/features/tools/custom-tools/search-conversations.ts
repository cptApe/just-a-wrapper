import { z } from 'zod';
import { SEARCH_CONVERSATIONS_DECL } from '@/features/tool-catalog/declarations';
import type { CustomTool } from '@/features/tool-catalog/types';

const SearchConversationsInputSchema = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(25).default(10),
});

export const SearchConversationsOutputSchema = z.object({
  conversations: z.array(
    z.object({
      task_id: z.string(),
      title: z.string(),
      last_active_at: z.string(),
      href: z.string(),
      snippet: z.string(),
    }),
  ),
  unsearchable: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

type SearchInput = z.infer<typeof SearchConversationsInputSchema>;
type SearchOutput = z.infer<typeof SearchConversationsOutputSchema>;
const SNIPPET_MAX_CHARS = 220;

function searchableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Return a compact excerpt around the first case-insensitive phrase match. */
function conversationMatchSnippet(query: string, textValue: string): string | null {
  const normalizedQuery = searchableText(query).toLowerCase();
  if (normalizedQuery === '') return null;
  const text = searchableText(textValue);
  const matchAt = text.toLowerCase().indexOf(normalizedQuery);
  if (matchAt < 0) return null;
  const contextChars = Math.max(0, SNIPPET_MAX_CHARS - normalizedQuery.length);
  const beforeChars = Math.floor(contextChars / 2);
  const afterChars = contextChars - beforeChars;
  const start = Math.max(0, matchAt - beforeChars);
  const end = Math.min(text.length, matchAt + normalizedQuery.length + afterChars);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export const searchConversationsTool: CustomTool<SearchInput, SearchOutput> = {
  ...SEARCH_CONVERSATIONS_DECL,
  inputSchema: SearchConversationsInputSchema,
  outputSchema: SearchConversationsOutputSchema,
  async handler(input, ctx) {
    const [{ queryConversationMatches }, match] = await Promise.all([
      import('@/features/search/api/query-conversation-matches'),
      import('@/features/search/lib/match'),
    ]);
    const query = match.normalizeQuery(input.query);
    const result = await queryConversationMatches({
      workspaceId: ctx.workspaceId,
      viewerId: ctx.userId,
      currentAnthropicSessionId: ctx.sessionId,
      contains: `%${match.escapeLike(query)}%`,
      limit: input.limit,
    });
    let skipped = 0;
    const conversations = result.matches.flatMap((row) => {
      const title = row.title ?? 'Untitled task';
      const snippet =
        (row.searchText ? conversationMatchSnippet(query, row.searchText) : null) ??
        conversationMatchSnippet(query, title);
      if (!snippet || !Number.isFinite(row.lastActiveAt.getTime())) {
        skipped += 1;
        return [];
      }
      return [
        {
          task_id: row.id,
          title,
          last_active_at: row.lastActiveAt.toISOString(),
          href: `/app/task/${row.id}`,
          snippet,
        },
      ];
    });
    return { conversations, unsearchable: result.unsearchableCount, skipped };
  },
};
