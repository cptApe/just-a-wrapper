'use client';
import { memo } from 'react';
import { MessageFooter, MessageGroup } from '@/components/ui/message';
import { MessageScrollerItem } from '@/components/ui/message-scroller';
import type { ArtifactSummary } from '@/features/files/types';
import { cn } from '@/lib/utils';
import type { ChatItem, ChatTurn } from '../lib/chat-state';
import { selectReply } from '../lib/chat-turns';
import { type FoldChainOptions, foldChainNodes } from '../lib/fold-chain';
import { collectTurnFiles } from '../lib/turn-files';
import type { AuthorChip } from '../types';
import { ChatItemRow } from './chat-item-row';
import { MessageActions } from './message-actions';
import { PIN_ROOM_CLASS, type PinRoomCompensation, PinRoomSpacer } from './pin-room-spacer';
import { StreamingMessage } from './streaming-message';
import { ThinkingBlock } from './thinking-block';
import { ToolChain } from './tool-chain';
import { showsResultFilesInline } from './tool-renderers/registry';
import { TurnFiles } from './turn-files';
import { WorkingIndicator } from './working-indicator';

/** Two item lists are the "same turn" when they hold the exact same item objects
 *  in order. The store replaces only the items an event touched (immutable
 *  update), so an unchanged turn's items stay reference-identical — which is how
 *  `TurnView`'s comparator recognises a settled turn and skips the whole fold +
 *  file-collect recompute while a later turn streams. */
function sameItems(a: ChatItem[], b: ChatItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

type TurnViewProps = {
  turn: ChatTurn;
  isLast: boolean;
  isPinned: boolean;
  sessionId: string;
  canWrite: boolean;
  foldOpts: FoldChainOptions;
  artifactsByFileId: ReadonlyMap<string, ArtifactSummary>;
  resolveAuthor?: (author: { userId: string; name: string }) => AuthorChip;
  working: boolean;
  /** The live reply is still landing in THIS turn — hides its action row. */
  receivingReply: boolean;
  /** This turn is the latest answer AT REST (last turn, no pending send) — its
   *  action row shows persistently; every other row is hover-revealed. */
  latestAtRest: boolean;
  /** Drops the pin room once it's stale (see PinRoomSpacer). Referentially
   *  stable, so it never breaks a settled turn's memo. */
  collapsePinRoom: () => void;
  /** Drops stale pin room above a newer turn and preserves viewport geometry. */
  releasePinRoom: (compensation: PinRoomCompensation) => void;
  streamingPreview: boolean;
  previewInLastTurn: boolean;
  previewText: string | null;
  thinkingPreview: boolean;
  showIndicator: boolean;
  indicatorDelayed: boolean;
};

/** A turn is unchanged when its items are reference-identical and every other
 *  input is identity-equal. The store keeps settled items referentially stable
 *  (immutable update), so this skips the fold + file-collect for every turn but
 *  the one an event actually touched — the whole point of `TurnView` being
 *  memoized. Comparing every non-turn prop generically means a newly-added prop
 *  can't be silently forgotten here. */
function turnPropsEqual(prev: TurnViewProps, next: TurnViewProps): boolean {
  if (prev.turn.key !== next.turn.key || !sameItems(prev.turn.items, next.turn.items)) return false;
  const previousValues: Record<string, unknown> = prev;
  const nextValues: Record<string, unknown> = next;
  for (const key of Object.keys(nextValues)) {
    if (key === 'turn') continue;
    if (!Object.is(previousValues[key], nextValues[key])) return false;
  }
  return true;
}

// One turn's worth of rendering — the fold, the rows, the streaming slots, and
// the tail file strip. Memoized (turnPropsEqual) so a settled turn never re-folds
// or re-parses its media results while a later turn streams.
export const TurnView = memo(function TurnView({
  turn,
  isLast,
  isPinned,
  sessionId,
  canWrite,
  foldOpts,
  artifactsByFileId,
  resolveAuthor,
  working,
  receivingReply,
  latestAtRest,
  collapsePinRoom,
  releasePinRoom,
  streamingPreview,
  previewInLastTurn,
  previewText,
  thinkingPreview,
  showIndicator,
  indicatorDelayed,
}: TurnViewProps) {
  const nodes = foldChainNodes(turn.items, foldOpts);
  // The files this turn produced, collected + deduped against what already
  // rendered inline. Mounts at the turn's tail, below its
  // items and any chain.
  const turnFiles = collectTurnFiles(turn.items, {
    artifactOf: (fileId) => artifactsByFileId.get(fileId),
    showsResultFilesInline,
  });
  // Keep the action row at a stable turn-tail position as later tools arrive.
  // Copy and Read aloud cover the whole reply; feedback keys on its last message.
  const reply = selectReply(turn.items);
  const tailId = turn.items.at(-1)?.id ?? null;

  return (
    // messageId powers the imperative pin + jump-to-message; the pin is driven
    // from the effects in ChatThreadInner, not the scroll-anchor auto-pin.
    <MessageScrollerItem messageId={turn.key} data-testid="turn">
      {/* The PINNED turn carries the pin room (PIN_ROOM_CLASS) so it can sit
          at its park position with space below — see pinRoom. Replayed history is never
          pinned, so it stays compact; the scroller clamps the slight over-reserve.
          The spacer at the tail collapses the room once it's stale (settled +
          scrolled past) — `working` is false for every non-last turn, so a pin
          orphaned mid-thread by a queued send arms too. */}
      <MessageGroup className={cn('group/turn gap-3 pb-3', isPinned && PIN_ROOM_CLASS)}>
        {nodes.map((node) =>
          node.kind === 'chain' ? (
            <ToolChain
              key={node.key}
              items={node.items}
              runs={node.runs}
              active={isLast && node.items.at(-1)?.id === tailId && working && !streamingPreview}
              artifactsByFileId={artifactsByFileId}
              sessionId={canWrite ? sessionId : undefined}
            />
          ) : (
            <ChatItemRow
              key={
                node.item.type === 'message' ? (node.item.localId ?? node.item.id) : node.item.id
              }
              item={node.item}
              isLastTurn={isLast}
              working={working}
              resolveAuthor={resolveAuthor}
              artifactsByFileId={artifactsByFileId}
            />
          ),
        )}
        {/* The reply streaming into ITS turn (see previewInLastTurn). */}
        {isLast && previewInLastTurn && streamingPreview && previewText ? (
          <StreamingMessage text={previewText} />
        ) : null}
        {isLast && previewInLastTurn && !streamingPreview && thinkingPreview ? (
          <ThinkingBlock />
        ) : null}
        {/* Awaiting the reply: the indicator sits in the same slot the preview
            will stream into, so the swap is in place. */}
        {isLast && previewInLastTurn && showIndicator ? (
          <WorkingIndicator delayed={indicatorDelayed} />
        ) : null}
        {/* The turn's generated files, pinned to its tail. */}
        <TurnFiles sessionId={sessionId} files={turnFiles} />
        {reply && !receivingReply ? (
          <MessageFooter
            className={cn(
              'px-0',
              // The row replaces the indicator the moment the turn settles;
              // a short fade keeps that swap from reading as a pop.
              latestAtRest && 'animate-in fade-in-0 duration-200 motion-reduce:animate-none',
              !latestAtRest &&
                'opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/turn:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none',
            )}
          >
            <MessageActions
              key={reply.eventId}
              sessionId={sessionId}
              eventId={reply.eventId}
              text={reply.text}
              canRate={canWrite}
            />
          </MessageFooter>
        ) : null}
        {isPinned ? (
          <PinRoomSpacer
            armed={!working}
            release={!isLast}
            onStale={collapsePinRoom}
            onRelease={releasePinRoom}
          />
        ) : null}
      </MessageGroup>
    </MessageScrollerItem>
  );
}, turnPropsEqual);
