'use client';
import { useEffect, useMemo, useState } from 'react';
import { IconArrowDown } from '@/components/icons';
import { MessageGroup } from '@/components/ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '@/components/ui/message-scroller';
import type { ArtifactSummary } from '@/features/files/types';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';
import { useChatPin } from '../hooks/use-chat-pin';
import { useMessageFeedback } from '../hooks/use-message-feedback';
import type { ChatItem } from '../lib/chat-state';
import { groupTurns } from '../lib/chat-turns';
import { type FoldChainOptions, foldChainNodes } from '../lib/fold-chain';
import type { AuthorChip } from '../types';
import { TurnView } from './chat-turn';
import { PendingBubble, type PendingSend } from './pending-bubble';
import { PIN_ROOM_CLASS } from './pin-room-spacer';
import { StreamingMessage } from './streaming-message';
import { ThinkingBlock } from './thinking-block';
import { useToolDecisionsView } from './tool-decisions-context';
import { resolveToolVisibility } from './tool-renderers/registry';
import { WorkingIndicator } from './working-indicator';

/** How close to the bottom still counts as "at the bottom" (scrollEdgeThreshold). */
const BOTTOM_THRESHOLD_PX = 80;

/** After the replay settles, keep following the bottom this long — async extras
 *  (the artifact grid, the banner) mount just after and would otherwise leave
 *  the "open at the bottom" landing short. Any user scroll cancels it. */
const SETTLE_FOLLOW_GRACE_MS = 1500;

declare global {
  interface Window {
    /** Dev/e2e affordance: jump the thread to a message by id (contract). */
    __chatScroll?: { scrollToMessage: (id: string) => boolean };
  }
}

/** Whether a folded node conveys "the agent is alive" at the tail — a running
 *  chain, a running tool card, an active thinking marker, or a running subagent lane. */
function nodeShowsLife(node: ReturnType<typeof foldChainNodes>[number]): boolean {
  if (node.kind === 'chain') {
    const last = node.items.at(-1);
    if (!last) return false;
    return last.type === 'thinking' || (last.type === 'tool' && !last.result);
  }
  const item = node.item;
  // A settled thinking item renders nothing (see the 'thinking' case in
  // ChatItemRow), so it must not hide the working indicator: the reply model
  // emits one right before its text lands, and the thread went blank for that
  // beat. Live reasoning shows through thinkingPreview, not through the item.
  return (
    (item.type === 'tool' && !item.result) ||
    (item.type === 'subagent' && item.status === 'running')
  );
}

type ChatThreadProps = {
  sessionId: string;
  canWrite: boolean;
  items: ChatItem[];
  working: boolean;
  pending?: PendingSend[];
  /** True when the freshest pending send should pin to the top; false for a
   * message queued while a reply streams (it sits at the bottom instead). */
  pinPending?: boolean;
  onRetry?: (localId: string, text: string) => void;
  /** Resolves a turn's author tag against the workspace member directory. */
  resolveAuthor?: (author: { userId: string; name: string }) => AuthorChip;
  /** Session artifacts keyed by Anthropic file id — powers the per-turn strip. */
  artifactsByFileId: ReadonlyMap<string, ArtifactSummary>;
  /** True once the initial history replay has landed — bottom-following stops. */
  replaySettled: boolean;
  /** Live delta preview of the reply being generated, or null. */
  previewText?: string | null;
  /** An agent.thinking preview started — show the thinking state before the
   *  buffered thinking event arrives. */
  thinkingPreview?: boolean;
};

export function ChatThread(props: ChatThreadProps) {
  useMessageFeedback(props.sessionId, props.canWrite);
  // Follow the bottom while the replay streams in and for a short grace after it
  // settles, then stand down — from then on NO auto-scroll (a scroll-to-bottom
  // button instead). `autoScroll` is the primitive's follow-output switch.
  const [followReplay, releaseFollow] = useState(true);
  useEffect(() => {
    if (!props.replaySettled) return;
    const timer = window.setTimeout(() => releaseFollow(false), SETTLE_FOLLOW_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [props.replaySettled]);

  return (
    <MessageScrollerProvider
      autoScroll={followReplay}
      defaultScrollPosition="end"
      scrollEdgeThreshold={BOTTOM_THRESHOLD_PX}
    >
      <ChatThreadInner {...props} />
    </MessageScrollerProvider>
  );
}

function ChatThreadInner({
  sessionId,
  canWrite,
  items,
  working,
  pending = [],
  pinPending = true,
  onRetry,
  resolveAuthor,
  artifactsByFileId,
  previewText = null,
  thinkingPreview = false,
}: ChatThreadProps) {
  const { scrollToMessage } = useMessageScroller();
  // The pin travels smoothly (the primitive's default is an instant jump);
  // reduce-motion users keep the jump, same policy as MessageScrollerButton.
  const reduceMotion = usePrefersReducedMotion();
  const pinBehavior: ScrollBehavior = reduceMotion ? 'auto' : 'smooth';

  // Group into turns once per items change. The per-turn fold + file-collect is
  // deferred to `TurnView` (memoized): its comparator treats a turn as unchanged
  // when its items are reference-identical, so every settled turn skips that work
  // on each streaming frame — only the turn actually receiving events recomputes.
  const turns = useMemo(() => groupTurns(items), [items]);
  // Whitespace-only preview (a reply that opens with a newline) renders
  // nothing, so it must not stand down the indicator.
  const streamingPreview = Boolean(previewText?.trim());
  const lastTurnKey = turns.at(-1)?.key ?? null;
  // Quiet items (thinking + hidden/whisper/process tools) fold into
  // one collapsed chain per reply. The fold is pure; the
  // renderer resolves each tool's tier and whether it is parked on a gate.
  // Memoized on the pending decisions, which keep their identity across
  // streaming frames. Text stays below the combined work, live or settled.
  const { pending: pendingDecisions } = useToolDecisionsView();
  const foldOpts: FoldChainOptions = useMemo(
    () => ({
      visibilityOf: (tool) => resolveToolVisibility(tool.name, tool.input),
      isPendingGate: (id) => pendingDecisions.has(id),
    }),
    [pendingDecisions],
  );
  // The live preview renders INSIDE the last real turn (not the synthetic
  // item): the pinned turn then grows in place as text streams, the pin
  // spacer tracks its true height, and the preview→buffered swap happens in
  // the same container — no end-of-stream teleport, no leftover gap. Only
  // when no turn exists yet (echo not landed) does the preview fall back to
  // the synthetic item.
  const previewInLastTurn = lastTurnKey !== null && pending.length === 0;
  // The working indicator shows ONLY when nothing else on screen already says
  // "the agent is alive" (one indicator, never duplicated): no reply
  // streaming, no thinking shimmer, no running tool/chain or subagent lane at
  // the tail. The tail is read from the FOLDED last turn: a lone hidden tool
  // running at the tail is folded away (renders nothing), so the generic
  // indicator must take over — otherwise the thread looks frozen.
  const lastTurn = turns.at(-1);
  // The last turn's REPLY is still in flight — the action-row gate. Distinct
  // from the fold options: a fresh optimistic send (pinPending, pending > 0)
  // must NOT strip the previous, answered turn's action row. A message queued
  // while a reply streams (!pinPending) keeps the streaming turn's actions
  // hidden because its reply is still landing there.
  const lastTurnReceivingReply = working && (pending.length === 0 || !pinPending);
  // Folded with the same options the last turn itself gets, so the indicator
  // finds the chronological tail even when its chain renders above the text.
  const lastNodes = useMemo(
    () => (lastTurn ? foldChainNodes(lastTurn.items, foldOpts) : []),
    [lastTurn, foldOpts],
  );
  const lastItemId = lastTurn?.items.at(-1)?.id;
  const tailNode = lastNodes.find((node) =>
    node.kind === 'chain' ? node.items.at(-1)?.id === lastItemId : node.item.id === lastItemId,
  );
  const tailShowsLife = tailNode !== undefined && nodeShowsLife(tailNode);
  const showIndicator = working && !streamingPreview && !thinkingPreview && !tailShowsLife;
  // The reply text has landed and the turn is only waiting for its final
  // status: the indicator under the finished text would flash for a moment
  // before the action row replaced it. In that case it fades in late, so a
  // turn that really continues (a tool after the text) still shows it and a
  // turn that is about to settle never does.
  const indicatorDelayed =
    tailNode?.kind === 'item' &&
    tailNode.item.type === 'message' &&
    tailNode.item.role === 'assistant' &&
    tailNode.item.text.trim().length > 0;
  const hasSyntheticTurn =
    pending.length > 0 ||
    ((streamingPreview || thinkingPreview || showIndicator) && !previewInLastTurn);

  const { pinnedKey, collapsePinRoom, releasePinRoom } = useChatPin({
    scrollToMessage,
    turns,
    pending,
    pinPending,
    pinBehavior,
    lastTurnKey,
  });

  return (
    // Same scroll-fade logic as the sidebar, tuned deeper (24px vs its 16px)
    // because the thread is a much taller surface; the scroller's default
    // (min(12%, 40px)) read as a heavy fixed gradient.
    <MessageScroller className="min-h-0 flex-1 [--scroll-fade-size:24px]">
      <MessageScrollerViewport aria-label="Conversation" data-testid="chat-thread">
        {/* Hide the primitive bottom spacer because it retains space after a pinned turn.
         * Give the last message group min-height instead so pin room travels with the turn. */}
        <MessageScrollerContent
          className="mx-auto max-w-3xl gap-0 px-4 pb-12 pt-6"
          spacerClassName="hidden"
        >
          {turns.map((turn) => {
            const isLast = turn.key === lastTurnKey;
            // Streaming-only inputs matter ONLY to the last turn; a settled turn
            // gets them as stable constants so its memo never breaks on a frame
            // that just grew the live reply (which isn't in this turn's items).
            return (
              <TurnView
                canWrite={canWrite}
                key={turn.key}
                turn={turn}
                isLast={isLast}
                isPinned={turn.key === pinnedKey}
                sessionId={sessionId}
                foldOpts={foldOpts}
                artifactsByFileId={artifactsByFileId}
                resolveAuthor={resolveAuthor}
                working={isLast ? working : false}
                receivingReply={isLast ? lastTurnReceivingReply : false}
                latestAtRest={isLast && pending.length === 0}
                collapsePinRoom={collapsePinRoom}
                releasePinRoom={releasePinRoom}
                streamingPreview={isLast ? streamingPreview : false}
                previewInLastTurn={isLast ? previewInLastTurn : false}
                previewText={isLast ? previewText : null}
                thinkingPreview={isLast ? thinkingPreview : false}
                showIndicator={isLast ? showIndicator : false}
                indicatorDelayed={isLast ? indicatorDelayed : false}
              />
            );
          })}

          {hasSyntheticTurn ? (
            <MessageScrollerItem messageId="__pending__">
              {/* A fresh optimistic send carries the pin room from the moment
                  send is pressed (see pinRoom) — the echoed turn inherits it. */}
              <MessageGroup
                className={cn(
                  'gap-3 pb-3',
                  pinnedKey === '__pending__' && pending.length > 0 && PIN_ROOM_CLASS,
                )}
              >
                {/* Queued/optimistic sends sit at the thread bottom and animate in. */}
                {pending.map((p) => (
                  <PendingBubble key={p.localId} pending={p} onRetry={onRetry} />
                ))}
                {/* Preview fallback: only before the echoed turn exists (see
                    previewInLastTurn) — otherwise it streams inside its turn.
                    The indicator holds the same slot until the reply starts. */}
                {!previewInLastTurn && streamingPreview && previewText ? (
                  <StreamingMessage text={previewText} />
                ) : null}
                {!previewInLastTurn && !streamingPreview && thinkingPreview ? (
                  <ThinkingBlock />
                ) : null}
                {!previewInLastTurn && showIndicator ? <WorkingIndicator /> : null}
              </MessageGroup>
            </MessageScrollerItem>
          ) : null}
        </MessageScrollerContent>
      </MessageScrollerViewport>

      {/* A plain 32px bordered pill, rendered directly so Button variant classes
          do not merge in. The primitive contributes positioning and the
          show/hide transition via its own className. */}
      <MessageScrollerButton
        data-testid="scroll-to-bottom"
        aria-label="Scroll to the latest message"
        render={
          <button
            type="button"
            className="max-md:size-11 max-md:flex max-md:items-center max-md:justify-center rounded-button border bg-background p-2 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          />
        }
      >
        <IconArrowDown className="size-4" />
      </MessageScrollerButton>
    </MessageScroller>
  );
}
