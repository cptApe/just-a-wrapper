'use client';
import { IconAlertCircle } from '@/components/icons';
import { TIER_DISPLAY } from '@/features/agents/config';
import type { UploadConfig } from '@/features/files';
import type { SessionLiveState, WorkspaceSessionDetail } from '@/features/sessions';
import { useChatViewState } from '../hooks/use-chat-view-state';
import { selectPreviewText } from '../lib/chat-preview';
import { CREDITS_EXHAUSTED_BANNER_ID } from '../lib/composer-banner-store';
import { composerBottomSafeAreaClass } from '../lib/composer-geometry';
import type { ThreadMember } from '../types';
import { ChatHeader } from './chat-header';
import { ChatRetryContext } from './chat-retry-context';
import { ChatThread } from './chat-thread';
import { ChatThreadSkeleton } from './chat-thread-skeleton';
import { ChatViewStreamErrorToast } from './chat-view-stream-error-toast';
import { Composer } from './composer';
import { ComposerBannerSlot } from './composer-banner-slot';
import { ComposerMetaRow } from './composer-meta-row';
import { ComposerQueue } from './composer-queue';
import { CreditsExhaustedBanner } from './credits-exhausted-banner';
import { ToolDecisionsContext } from './tool-decisions-context';

type ChatViewProps = {
  loadContext?: boolean;
  sessionId: string;
  workspaceId?: string;
  /** Better Auth org id — keys the realtime channel that clears the paused banner. */
  organizationId?: string;
  /** The viewer's user id — keys their private member realtime channel. */
  userId?: string;
  /** DB session state at page load; pausedReason selects the right remedy. */
  initialStatus?: SessionLiveState | null;
  uploadConfig?: UploadConfig;
  /** The session row for the header (title, pin state); null falls back gracefully. */
  session?: WorkspaceSessionDetail | null;
  /** Workspace member directory for author chips; passed only for a shared task. */
  members?: ThreadMember[];
};

// Every store under the view (transcript, pending sends, tool requests, the browser panel) is
// created once for one session, so the view keys itself: no caller can show one chat's state in another.
export function ChatView(props: ChatViewProps) {
  return <ChatViewBody key={props.sessionId} {...props} />;
}

// Connect SSE state, transcript and composer with explicit connecting, streaming,
// error and settled states. Reconcile optimistic sends against echoed messages.
// Tool decisions reach every tool line through context; paused tasks expose credit recovery above the composer.
function ChatViewBody({
  sessionId,
  workspaceId: suppliedWorkspaceId,
  organizationId,
  userId,
  initialStatus: suppliedStatus,
  uploadConfig: suppliedUploadConfig,
  session: suppliedSession = null,
  members: suppliedMembers,
  loadContext = false,
}: ChatViewProps) {
  const {
    context: { session, canWrite, workspaceId, uploadConfig, resolveAuthor },
    stream: { meta, remint, state, connecting, empty, replaySettled, working },
    thread: {
      threadItems,
      threadPending,
      pinPending,
      onRetry,
      retryTask,
      artifactsByFileId,
      toolDecisions,
    },
    composer: { queueCards, retryQueuedCard, onSend, stopping, onStop, sendError },
    credits: { pausedNoCredits, pausedReason, onResume, resuming },
  } = useChatViewState({
    organizationId,
    sessionId,
    loadContext,
    suppliedSession,
    suppliedMembers,
    suppliedWorkspaceId,
    suppliedUploadConfig,
    suppliedStatus,
    userId,
  });

  return (
    <ChatRetryContext value={canWrite ? retryTask : null}>
      <div className="flex h-full flex-col">
        <ChatHeader sessionId={sessionId} session={session} canWrite={canWrite} />

        <ChatViewStreamErrorToast sessionId={sessionId} error={meta.error} remint={remint} />

        {connecting ? (
          // Empty loading slot while the stream attaches and history replays: its
          // flex-1 holds the composer at the bottom until the real transcript
          // replaces it (no guessed turns, since history may be empty).
          <ChatThreadSkeleton />
        ) : empty && !replaySettled && meta.error ? (
          <div className="flex-1" />
        ) : empty ? (
          <EmptyState />
        ) : (
          <ToolDecisionsContext value={toolDecisions}>
            <ChatThread
              canWrite={canWrite}
              sessionId={sessionId}
              items={threadItems}
              working={working}
              pending={threadPending}
              pinPending={pinPending}
              onRetry={onRetry}
              resolveAuthor={resolveAuthor}
              artifactsByFileId={artifactsByFileId}
              replaySettled={replaySettled}
              previewText={selectPreviewText(state)}
              thinkingPreview={state.activity.thinking === 'streaming'}
            />
          </ToolDecisionsContext>
        )}

        {/* Place the exhausted-credit banner above the composer. */}
        {pausedNoCredits && canWrite ? (
          <div className="px-4">
            <CreditsExhaustedBanner reason={pausedReason} onResume={onResume} resuming={resuming} />
          </div>
        ) : null}

        {/* Persistent, actionable conditions dock above the composer, in flow so the thread
          absorbs their height. A paused task's banner above already explains a refused send. */}
        <ComposerBannerSlot
          omit={pausedNoCredits && canWrite ? CREDITS_EXHAUSTED_BANNER_ID : undefined}
        />

        {/* The composer slot carries the bottom safe-area pad as one group. */}
        <div className={composerBottomSafeAreaClass}>
          {/* Mid-run messages the agent hasn't reached yet stack directly above
            the composer, in its column — visually attached to the input they
            left from. */}
          <ComposerQueue items={queueCards} onRetry={retryQueuedCard} />
          <Composer
            draftKey={sessionId}
            onSend={onSend}
            streaming={working}
            paused={pausedNoCredits}
            stopping={stopping}
            onStop={() => void onStop()}
            attach={workspaceId && uploadConfig ? { workspaceId, uploadConfig } : null}
            libraryPicker
            skillPicker
            placeholder="Message the agent…"
            readOnly={!canWrite}
          />
          {sendError ? (
            <div className="px-4">
              <p
                role="alert"
                data-testid="task-send-error"
                className="mx-auto mt-2 flex w-full max-w-3xl items-start gap-1.5 px-1 text-meta font-normal text-destructive"
              >
                <IconAlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{sendError}</span>
              </p>
            </div>
          ) : null}
          {/* The meta line shares the bottom clearance zone (see
            composer-geometry): agent mode left, disclaimer right. */}
          <ComposerMetaRow plan={session ? TIER_DISPLAY[session.tier].label : undefined} />
        </div>
      </div>
    </ChatRetryContext>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-title-card font-semibold">No messages yet</p>
      <p className="max-w-md text-meta text-muted-foreground">
        Send a message below to get the conversation going.
      </p>
    </div>
  );
}
