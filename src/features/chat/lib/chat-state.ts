import type { TokenUsage } from '@/features/agents';
import type {
  ChatErrorRetryStatus,
  ChatFileRef,
  ChatToolKind,
  SessionPauseReason,
} from '@/features/sessions';
import type { OptimisticComposerAttachment } from '@/features/sessions/lib/build-composer-message';
import type { ChatStatus } from '@/lib/chat-status';
import { type ChatActivity, initialActivity } from './chat-activity-machine';
import type { LaneStatus } from './lane-machine';

/** A settled tool call's outcome, as the tool card renders it. */
export type ToolResult = {
  isError: boolean;
  text: string;
  /** When the result arrived. Absent on old history events without processed_at. */
  at?: string;
  /** Files the result's content blocks referenced — rich outputs render inline. */
  fileRefs?: ChatFileRef[];
};

export type ToolChatItem = {
  type: 'tool';
  id: string;
  tool: ChatToolKind;
  name: string;
  serverName?: string;
  input: Record<string, unknown>;
  at?: string;
  result?: ToolResult;
  /** Anthropic's permission evaluation — `'ask'` parks the session on a gate. */
  evaluatedPermission?: 'allow' | 'ask' | 'deny';
  /** The answered gate (user click or relay auto-approve), once it streams back. */
  confirmation?: 'allow' | 'deny';
  /** Originating helper thread for a cross-posted custom call. */
  threadId?: string;
};

export type SubagentEntry =
  | { id: string; sub: 'message'; direction: 'sent' | 'received'; text: string; at?: string }
  | { id: string; sub: 'status'; status: LaneStatus; at?: string }
  | { id: string; sub: 'tool'; item: ToolChatItem };

export type ChatItem =
  | {
      type: 'message';
      id: string;
      role: 'user' | 'assistant';
      /** Stable local turn key, retained when the server echo replaces the anchor. */
      localId?: string;
      presentation?: 'thread' | 'stack';
      attachments?: OptimisticComposerAttachment[];
      text: string;
      at?: string;
      /** Anthropic file ids referenced inline — powers the per-turn file strip. */
      fileIds?: string[];
      /** Teammate who wrote this turn on a shared task; creator turns carry none. */
      author?: { userId: string; name: string };
    }
  | {
      type: 'thinking';
      id: string;
      at?: string;
      /** The enclosing span's start→end duration. Not rendered (settled
       *  thinking shows nothing), kept as timing data on the item. */
      durationMs?: number;
    }
  | {
      type: 'browser_control';
      id: string;
      controlledByUser: boolean;
      text: string;
      at?: string;
    }
  | ToolChatItem
  | {
      type: 'error';
      id: string;
      text: string;
      at?: string;
      errorType?: string;
      retryStatus?: ChatErrorRetryStatus;
    }
  /** One subagent thread, collapsed by default. */
  | {
      type: 'subagent';
      id: string;
      threadId: string;
      agentName?: string;
      status: LaneStatus;
      at?: string;
      entries: SubagentEntry[];
    };

export type ChatSessionState =
  | {
      status: Exclude<ChatStatus, 'idle' | 'paused_no_credits'> | null;
      stopReason: null;
      pausedReason: null;
    }
  | { status: 'idle'; stopReason: string | null; pausedReason: null }
  | { status: 'paused_no_credits'; stopReason: null; pausedReason: SessionPauseReason | null };

export type ChatState = ChatSessionState & {
  /** Ordered, render-ready items (messages, thinking, tool calls, errors, subagent lanes). */
  items: ChatItem[];
  /** Accumulated model token usage across the session. */
  usage: TokenUsage;
  /** Latest session status (running / idle / …), or null before the first. */
  statusAt: string | null;
  /** Last Anthropic event id folded in — the resume cursor surfaced in the UI. */
  lastEventId: string | null;
  /** Every event id seen, for idempotent replay. */
  seen: ReadonlySet<string>;
  /**
   * Bumps whenever an event carrying Files-API refs folds in — the "an
   * artifact exists, refetch the list" signal (use-session-artifacts.ts).
   * Monotonic, never reset; dedup makes replays signal-free.
   */
  artifactSignal: number;
  /** span.model_request_start timestamps by event id — pairs thinking durations. */
  spanStarts: ReadonlyMap<string, string>;
  /** tool_result / tool_confirmation retained until their tool_use appears. */
  orphanResults: ReadonlyMap<string, ToolResult>;
  orphanConfirmations: ReadonlyMap<string, 'allow' | 'deny'>;
  activity: ChatActivity;
};

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

export function createInitialState(): ChatState {
  return {
    items: [],
    usage: { ...ZERO_USAGE },
    status: null,
    statusAt: null,
    pausedReason: null,
    stopReason: null,
    lastEventId: null,
    seen: new Set(),
    artifactSignal: 0,
    spanStarts: new Map(),
    orphanResults: new Map(),
    orphanConfirmations: new Map(),
    activity: initialActivity(),
  };
}

export type MessageChatItem = Extract<ChatItem, { type: 'message' }>;

export type ChatTurn = { key: string; items: ChatItem[] };
