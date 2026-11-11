// Shared chat events narrow SDK events into UI-facing message, tool and status shapes.
// Keep the upstream event id for browser reconnect deduplication.
// See api/relay-frames.ts.

import type { AgentTier, TokenUsage } from '@/features/agents';
import type { ChatStatus } from '@/lib/chat-status';

/** A tool call surfaced to the UI — built-in, MCP, or custom tool. */
export type ChatToolKind = 'builtin' | 'mcp' | 'custom';

// Inline file references trigger artifact refetches; the artifact sweep owns file metadata.
export type ChatFileRef = {
  fileId: string;
  blockType: 'document' | 'image';
  /** Document title when the block carries one; images have none. */
  title: string | null;
};

/** Agent errors render quietly while retrying and visibly when exhausted or terminal.
 * Billing errors offer top-up; retry status mirrors the SDK union. */
export type ChatErrorRetryStatus = 'retrying' | 'exhausted' | 'terminal';

/** One subagent-thread happening, flattened onto the `thread` ChatEvent kind. */
export type ChatThreadDetail =
  | { sub: 'created' }
  | {
      sub: 'status';
      status: 'running' | 'idle' | 'rescheduled' | 'terminated';
      stopReason?: string;
    }
  | { sub: 'message'; direction: 'sent' | 'received'; text: string };

// Keep upstream type and processed_at for tracing. Optional timestamps allow frames from different
// relay builds during a deployment.
export type ChatEvent =
  | {
      id: string;
      kind: 'message';
      rawType: string;
      role: 'user' | 'assistant';
      sendId?: string;
      text: string;
      at?: string;
      /** Files referenced inline by this message's content blocks, if any. */
      fileRefs?: ChatFileRef[];

      author?: { userId: string; name: string };
    }
  | { id: string; kind: 'thinking'; rawType: string; at?: string }
  | {
      id: string;
      kind: 'browser_control';
      rawType: string;
      controlledByUser: boolean;
      text: string;
      at?: string;
    }
  | {
      id: string;
      kind: 'tool_use';
      rawType: string;
      tool: ChatToolKind;
      name: string;
      /** MCP server name, present only for `agent.mcp_tool_use`. */
      serverName?: string;
      input: Record<string, unknown>;
      at?: string;

      // An Anthropic 'ask' parks the session until confirmation; forward the evaluated permission so the
      // UI exposes the pending gate.
      evaluatedPermission?: 'allow' | 'ask' | 'deny';
      /** A confirmation folded by the relay from its own post, history, or
       * another attached relay before forwarding this tool use. */
      confirmation?: 'allow' | 'deny';
      /** Originating helper thread when the call was cross-posted. */
      threadId?: string;
    }
  | {
      id: string;
      kind: 'tool_result';
      rawType: string;
      toolUseId: string;
      isError: boolean;
      text: string;
      at?: string;
      /** Files referenced inline by this result's content blocks, if any. */
      fileRefs?: ChatFileRef[];
      /** Originating helper thread when the result was cross-posted. */
      threadId?: string;
    }
  | {
      id: string;
      kind: 'tool_confirmation';
      rawType: string;
      toolUseId: string;
      result: 'allow' | 'deny';
      at?: string;
      threadId?: string;
    }
  | {
      id: string;
      kind: 'status';
      rawType: string;
      status: ChatStatus;
      /** Why an idle session stopped. Absent on non-idle statuses and on frames
       * from relay builds that predate stop-reason forwarding. */
      stopReason?: string;
      at?: string;
    }
  | {
      id: string;
      kind: 'usage';
      rawType: string;
      usage: TokenUsage;
      at?: string;
      /** The matching span.model_request_start event id — pairs the span for
       * "thought for Xs" durations. */
      startId?: string;
    }
  | {
      id: string;
      kind: 'usage_snapshot';
      rawType: 'session.usage';
      usage: {
        inputTokens: number;
        outputTokens: number;
        cacheCreationTokens: number;
        cacheReadTokens: number;
      };
      at?: string;
    }
  /** span.model_request_start — forwarded only for its timestamp (span pairing). */
  | { id: string; kind: 'span_start'; rawType: string; at?: string }
  | {
      id: string;
      kind: 'error';
      rawType: string;
      text: string;
      at?: string;
      /** The SDK error variant (`billing_error`, `model_overloaded`, …). */
      errorType?: string;
      retryStatus?: ChatErrorRetryStatus;
    }
  /** Subagent thread events render in a nested subagent lane. */
  | {
      id: string;
      kind: 'thread';
      rawType: string;
      threadId: string;
      agentName?: string;
      at?: string;
      detail: ChatThreadDetail;
    }
  | { id: string; kind: 'raw'; rawType: string };

// Classify every SDK event explicitly. Unknown types fail completeness tests; intentionally
// dropped events remain in the event log.
export type EventClass = 'forward' | 'drop' | 'unknown';

// Anthropic message previews contain text fragments; thinking previews only announce their start.
export type ChatPreviewType = 'agent.message' | 'agent.thinking';

// Only persisted events advance the SSE resume cursor. Preview frames are display-only, never
// mirrored or replayed; the buffered event with the same ID is authoritative.
export type RelayFrame =
  | { type: 'event'; event: ChatEvent }
  /** A previewed event began upstream; deltas (message) or the buffered event
   * (thinking) follow, all carrying this `eventId`. */
  | { type: 'preview_start'; eventId: string; previewType: ChatPreviewType }
  /** One text fragment of the previewed agent.message. `index` addresses the
   * content-array entry the fragment extends (append, or create when new). */
  | { type: 'preview_delta'; eventId: string; index: number; text: string }
  | { type: 'meta'; sessionId: string; traceId: string | null; lastSeenEventId: string | null }
  /** Emitted after the complete initial history replay. */
  | { type: 'history' }
  | { type: 'heartbeat'; t: number }
  | { type: 'done'; reason: 'terminal' | 'closed' }
  /** The browser maps the code to its own copy; exception text stays in server telemetry. */
  | { type: 'error'; code: string };

// Library · use a skill). Both lists are resolved server-side by the page
// (read-only consumption of the files/skills public APIs) and passed down as
// plain data.

/** A Library file the composer can attach by reference (no re-upload). */
export type ComposerLibraryFile = {
  id: string;
  name: string;
  /** Authorized file content route — what the agent receives in <attached_files>. */
  url: string;
  mimeType: string;
  sizeBytes: number;
};

/** A Library folder the composer can attach by reference (same as New-task-with-folder). */
export type ComposerLibraryFolder = {
  /** Durable Library folder path — what the agent receives as the folder reference. */
  path: string;
  name: string;
  /** Direct file count, for the chip/tile caption. */
  itemCount: number;
};

/** A workspace skill the composer can reference in the opening message. */
export type ComposerSkill = {
  id: string;
  name: string;
  description: string | null;
};

// Only visible chat sessions with upstream IDs can open in the task route. Keep hidden rows for
// billing/audit while excluding them from lists.
export type WorkspaceSessionListItem = {
  id: string;
  title: string | null;
  status:
    | 'idle'
    | 'running'
    | 'rescheduling'
    | 'requires_input'
    | 'paused_no_credits'
    | 'terminated';
  /** Set when the user starred this session (sidebar favorite). */
  favoritedAt: Date | null;
  lastEventAt: Date | null;
  createdAt: Date;
  // Unread compares last_event_at with this viewer’s read state.
  unread: boolean;
  // Shared tasks owned by teammates appear under Team. A viewer own shared task stays in its normal
  // group with a sharing indicator.
  visibility: 'private' | 'workspace';
  /** The member who created this session — compared against the viewer to split
   *  own tasks from teammates' shared tasks. */
  createdByUserId: string;
  /** The creator's identity, for the Team-row avatar (Members-page treatment).
   *  Only rendered for teammates' shared rows; carried on every row so the one
   *  visibility-filtered list query is the single source. */
  createdBy: { name: string; email: string; image: string | null };
};

export type WorkspaceSessionsPage = {
  items: WorkspaceSessionListItem[];
  /** Opaque cursor for the next page, or null when this page is the last. */
  nextCursor: string | null;
};

export type WorkspaceSessionDetail = WorkspaceSessionListItem & {
  /** The immutable agent plan selected when this task was created. */
  tier: AgentTier;
  /** Whether the viewer created the session, derived per request from createdByUserId.
   * Task identity and sharing gates use this flag; conversation writes also consider visibility. */
  isOwner: boolean;
  /** Private tasks are creator-only; workspace tasks allow member contributions. */
  visibility: 'private' | 'workspace';
};
