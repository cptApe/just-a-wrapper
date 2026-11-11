'use client';
import { IconBrowser } from '@/components/icons';
import type { ArtifactSummary } from '@/features/files/types';
import type { ChatItem } from '../lib/chat-state';
import type { AuthorChip } from '../types';
import { AssistantMessage } from './assistant-message';
import { ErrorRow } from './error-row';
import { SubagentLane } from './subagent-lane';
import { ToolCallBlock } from './tool-call-block';
import { UserMessage } from './user-message';

export function ChatItemRow({
  item,
  isLastTurn,
  working,
  resolveAuthor,
  artifactsByFileId,
}: {
  item: ChatItem;
  isLastTurn: boolean;
  working: boolean;
  resolveAuthor?: (author: { userId: string; name: string }) => AuthorChip;
  artifactsByFileId: ReadonlyMap<string, ArtifactSummary>;
}) {
  switch (item.type) {
    case 'message': {
      if (item.role === 'user')
        return (
          <UserMessage
            text={item.text}
            attachments={item.attachments}
            at={item.at}
            author={item.author && resolveAuthor ? resolveAuthor(item.author) : undefined}
          />
        );
      return <AssistantMessage text={item.text} />;
    }
    case 'thinking': {
      // Settled thinking renders nothing; the working indicator owns the slot
      // (nodeShowsLife agrees), so the two never stack.
      return null;
    }
    case 'browser_control':
      return (
        <div
          className="flex items-center gap-2 px-1 py-1 text-body text-muted-foreground"
          data-testid="browser-control-whisper"
        >
          <IconBrowser aria-hidden className="size-3.5 shrink-0" />
          <span>{item.text.replace(/^\[|\]$/g, '')}</span>
        </div>
      );
    case 'tool':
      // One line per call; its tier (whisper, process, product) and its
      // decision state resolve inside the block. `live` tells a resultless
      // call whether it is still running or was interrupted with the turn.
      return (
        <ToolCallBlock
          item={item}
          artifactsByFileId={artifactsByFileId}
          live={isLastTurn && working}
        />
      );
    case 'error':
      return <ErrorRow item={item} />;
    case 'subagent':
      return <SubagentLane item={item} artifactsByFileId={artifactsByFileId} />;
  }
}
