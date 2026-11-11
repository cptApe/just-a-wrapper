'use client';
import Link from 'next/link';
import { z } from 'zod';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { formatDate } from '@/lib/format/format-date';
import { isSafeInternalHref } from '@/lib/safe-internal-href';
import { parseResultObject } from '../../lib/tool-result-data';
import { DefaultDetails } from './default-outcome';
import type { ToolRendererProps } from './tool-renderer-types';

const conversationSchema = z.object({
  title: z.string(),
  href: z.string(),
  last_active_at: z.string(),
  snippet: z.string(),
});
const searchSchema = z.object({ conversations: z.array(z.unknown()) });

export function ConversationSearchDetails({ item }: ToolRendererProps) {
  const { timeZone } = useDisplayFormat();
  if (!item.result) return null;
  if (item.result.isError) return <DefaultDetails item={item} />;
  const data = parseResultObject(item.result.text);
  const parsed = searchSchema.safeParse(data);
  if (!parsed.success) return <DefaultDetails item={item} />;
  const conversations = parsed.data.conversations.flatMap((value) => {
    const row = conversationSchema.safeParse(value);
    return row.success ? [{ ...row.data, lastActiveAt: row.data.last_active_at }] : [];
  });
  return (
    <div className="flex flex-col gap-2" data-testid="conversation-search-details">
      {conversations.length === 0 ? (
        <p className="text-meta text-muted-foreground">No conversations found</p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {conversations.map((conversation) => (
            <li key={conversation.href} className="min-w-0 text-meta">
              <p className="min-w-0">
                {isSafeInternalHref(conversation.href) ? (
                  <Link
                    href={conversation.href}
                    className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    {conversation.title}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{conversation.title}</span>
                )}
                <span className="text-muted-foreground">
                  {`, ${formatDate(conversation.lastActiveAt, timeZone)}`}
                </span>
              </p>
              {conversation.snippet.trim() !== conversation.title.trim() ? (
                <p className="line-clamp-2 text-muted-foreground">{conversation.snippet}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
