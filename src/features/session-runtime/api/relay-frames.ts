import type {
  BetaManagedAgentsSessionEvent,
  BetaManagedAgentsStreamSessionEvents,
} from '@anthropic-ai/sdk/resources/beta/sessions/events';
import { getAnthropicClient } from '@/features/agents';
import type { GateOutcome } from '@/features/permissions';
import { pendingStreamRead } from '@/features/sessions/lib/pending-stream-read';
import { AppError } from '@/lib/errors';
import { shipLog } from '@/lib/logger';
import { captureException } from '@/lib/observability';
import 'server-only';
import type { RelayBackgroundWork } from '@/features/sessions/api/create-background-work';
import {
  createRelayLife,
  observeFirstToken,
  observeLiveTurn,
  reportTurnIntegrity,
  scheduleTurnAnalytics,
  seedOpeningTurn,
} from '@/features/sessions/api/relay-life';
import {
  observeSearchEvent,
  scheduleSearchReconciliation,
} from '@/features/sessions/api/relay-search';
import { isStreamStalled } from '@/features/sessions/api/stream-stall';
import { raceWithTimeout, TIMEOUT } from '@/features/sessions/lib/race-with-timeout';
import { relayConnectionMachine } from '@/features/sessions/lib/relay-connection-machine';
import {
  collectUnresolvedGates,
  isPreviewEvent,
  isTerminalStreamEvent,
  translateEvent,
  translatePreviewEvent,
} from '@/features/sessions/lib/relay-translator';
import { CompletedTurnSearchCollector } from '@/features/sessions/lib/session-search-text';
import { statusForEvent } from '@/features/sessions/lib/status-for-event';
import type { RelayFrame } from '@/features/sessions/types';
import { applyGatePolicy } from './apply-gate-policy';
import {
  scheduleAccrual,
  scheduleArtifactSweep,
  scheduleEndAccrual,
  scheduleIntegrationBrokenNotify,
  scheduleMirror,
  scheduleStatusSync,
  scheduleUsageAccrual,
} from './schedule-relay-effects';

export type RelayInput = {
  sessionId: string;
  // Last-Event-ID header or ?last_event_id; null on fresh connect.
  lastEventId: string | null;
  // Fires when the browser disconnects.
  signal: AbortSignal;
  traceId: string | null;
  // Resolve gates under the session creator identity and permission mode. Allow/deny posts
  // confirmation; gate waits for the user. Browser custom-tool dispatch stays outside this relay.
  resolveGate: (toolName: string, toolInput: unknown) => Promise<GateOutcome>;
};

type AnthropicClient = NonNullable<ReturnType<typeof getAnthropicClient>>;
// Open live events before history, then deduplicate by upstream ID. Trim only visual replay by the
// browser cursor; cap connections so clients periodically reconnect.
const MAX_LIVE_EVENTS = 2000;
// Keepalive: emit a heartbeat if the upstream is silent this long, so proxies
// and the browser don't treat an idle (but live) session as a dead connection.
const HEARTBEAT_MS = 25_000;
const STREAM_OPEN_TIMEOUT_MS = 15_000;
const LIST_PAGE_TIMEOUT_MS = 30_000;
// Just below the route maxDuration (300s); done closes the connection and the browser resumes by cursor.
const RELAY_DEADLINE_MS = 280_000;

export async function* relayFrames(
  input: RelayInput,
  work: RelayBackgroundWork,
): AsyncGenerator<RelayFrame, void, unknown> {
  const client = getAnthropicClient();
  if (!client) {
    shipLog({
      level: 'warn',
      msg: 'sessions.relay_missing_key',
      feature: 'sessions',
      op: 'relay',
      session_id: input.sessionId,
    });
    yield { type: 'error', code: 'MISSING_KEY' };
    return;
  }
  yield* new RelayConnection(input, work, client).frames();
}

class RelayConnection {
  private readonly startedAt = Date.now();
  private readonly life = createRelayLife();
  private readonly seen = new Set<string>();
  private readonly completedTurns = new CompletedTurnSearchCollector();
  // Log every attach and close with counters so an upstream stream delivering no live events can be
  // distinguished from a healthy idle connection.
  private phase: 'connecting' | 'replaying' | 'tailing' | 'closed' = 'connecting';
  private liveCount = 0;
  private readonly input: RelayInput;
  private readonly work: RelayBackgroundWork;
  private readonly client: AnthropicClient;

  constructor(input: RelayInput, work: RelayBackgroundWork, client: AnthropicClient) {
    this.input = input;
    this.work = work;
    this.client = client;
  }

  async *frames(): AsyncGenerator<RelayFrame, void, unknown> {
    const { sessionId, traceId, lastEventId } = this.input;
    yield { type: 'meta', sessionId, traceId, lastSeenEventId: lastEventId };
    let stream: Awaited<ReturnType<RelayConnection['openStream']>> = null;
    try {
      stream = await this.openStream();
      if (!stream) {
        yield { type: 'done', reason: 'closed' };
        return;
      }
      const iterator = stream[Symbol.asyncIterator]();
      relayConnectionMachine.assertCan(this.phase, 'replaying');
      this.phase = 'replaying';
      yield* this.replayHistory();
      relayConnectionMachine.assertCan(this.phase, 'tailing');
      this.phase = 'tailing';
      yield* this.tail(iterator);
    } catch (error) {
      // Boundary catch: the server reports the failure once, and the browser gets only a code it
      // maps to its own copy, never exception text.
      captureException(error, { sessionId, feature: 'sessions', op: 'relay' });
      this.closeLog('error');
      yield { type: 'error', code: error instanceof AppError ? error.code : 'RELAY_FAILED' };
    } finally {
      // A generator return can cancel mid-pump without another close path. Close logging is idempotent
      // across all exits.
      this.closeLog('cancelled');
      // Release the upstream SDK stream on any exit (terminal, abort, error).
      stream?.controller.abort();
      this.work.close();
    }
  }

  private async openStream() {
    // Open before listing history so concurrent events are buffered for deduplication.
    const { sessionId } = this.input;
    const opening = this.client.beta.sessions.events.stream(
      sessionId,
      {
        event_deltas: ['agent.message', 'agent.thinking'],
      },
      { signal: this.input.signal },
    );
    // Bound stream opening independently of the long SDK timeout so a hung open triggers client
    // reconnection.
    const stream = await raceWithTimeout(Promise.resolve(opening), STREAM_OPEN_TIMEOUT_MS);
    if (stream !== TIMEOUT) return stream;
    // The browser reconnects after the deadline; release any late connection.
    void opening
      .then((late) => late.controller.abort())
      .catch((error) =>
        captureException(error, { sessionId, feature: 'sessions', op: 'relay-open-timeout' }),
      );
    this.closeLog('upstream-open-timeout');
    return null;
  }

  private async *replayHistory(): AsyncGenerator<RelayFrame, void, unknown> {
    const { sessionId, lastEventId } = this.input;
    // List all persisted history with per-page deadlines. A hung read must produce an error frame
    // rather than an open but silent stream.
    const history: BetaManagedAgentsSessionEvent[] = [];
    for await (const event of this.client.beta.sessions.events.list(sessionId, null, {
      timeout: LIST_PAGE_TIMEOUT_MS,
    }))
      history.push(event);
    this.seedHistory(history);
    const cursorIndex = lastEventId ? history.findIndex((event) => event.id === lastEventId) : -1;
    shipLog({
      msg: 'sessions.relay_attached',
      feature: 'sessions',
      op: 'relay',
      session_id: sessionId,
      history_events: history.length,
      cursor_found: cursorIndex >= 0,
    });
    const confirmations = await this.resolveHistoryGates(history);
    // A valid browser cursor trims visual replay only. Fresh or stale cursors receive the full
    // transcript.
    const replay = cursorIndex >= 0 ? history.slice(cursorIndex + 1) : history;
    for (const event of replay) {
      const translated = translateEvent(event);
      const confirmation = confirmations.get(event.id);
      const chat =
        translated?.kind === 'tool_use' && confirmation
          ? { ...translated, confirmation }
          : translated;
      if (chat) yield { type: 'event', event: chat };
    }
    yield { type: 'history' };
    // The latest status event repairs local state when no relay or webhook observed the transition;
    // unchanged state publishes nothing.
    const lastStatusEvent = history.findLast((event) => statusForEvent(event) !== null);
    if (lastStatusEvent) scheduleStatusSync(this.work, sessionId, lastStatusEvent);
    seedOpeningTurn(this.life, history, lastStatusEvent);
  }

  private seedHistory(history: BetaManagedAgentsSessionEvent[]): void {
    const { sessionId } = this.input;
    // Mirror and per-request usage cover the FULL listed history so trimming the visual replay
    // never weakens recovery: without webhooks, replay is the prompt path for usage the tail missed.
    for (const event of history) {
      this.seen.add(event.id);
      scheduleMirror(this.work, sessionId, event);
      scheduleUsageAccrual(this.work, sessionId, event);
      observeSearchEvent(this.completedTurns, event, translateEvent(event));
    }
    // Cumulative runtime needs only the latest terminal idle, not one provider read per turn.
    const lastTerminalIdle = history.findLast(
      (event) => event.type === 'session.status_idle' && isTerminalStreamEvent(event),
    );
    if (lastTerminalIdle) scheduleEndAccrual(this.work, sessionId, lastTerminalIdle);
    scheduleSearchReconciliation(this.completedTurns, this.work, sessionId);
  }

  private async resolveHistoryGates(history: BetaManagedAgentsSessionEvent[]) {
    const confirmations = new Map<string, 'allow' | 'deny'>();
    for (const event of history) {
      if (event.type === 'user.tool_confirmation')
        confirmations.set(event.tool_use_id, event.result);
    }
    const { sessionId, resolveGate } = this.input;
    // Resolve unanswered gates across all history before replay, including before the resume cursor.
    // Fold recorded or recovered answers into tool frames; duplicate confirmations reconcile safely.
    for (const gate of collectUnresolvedGates(history)) {
      const confirmation = await applyGatePolicy(this.client, sessionId, gate, resolveGate);
      if (confirmation === 'allow' || confirmation === 'deny')
        confirmations.set(gate.toolUseId, confirmation);
    }
    return confirmations;
  }

  private async *tail(
    iterator: AsyncIterator<BetaManagedAgentsStreamSessionEvents>,
  ): AsyncGenerator<RelayFrame, void, unknown> {
    let pending = pendingStreamRead(iterator);
    for (;;) {
      const stop = this.stopReason();
      if (stop) {
        this.closeLog(stop);
        break;
      }
      const reading = await raceWithTimeout(pending, HEARTBEAT_MS);
      if (reading === TIMEOUT) {
        if (await this.probeStall()) {
          this.closeLog('stall-detected');
          break;
        }
        yield { type: 'heartbeat', t: Date.now() - this.startedAt };
        continue;
      }
      if (reading.kind === 'error') {
        if (this.input.signal.aborted) break;
        throw new AppError(
          'EXTERNAL_API_FAILED',
          'Session stream read failed',
          { sessionId: this.input.sessionId },
          { cause: reading.cause },
        );
      }
      const next = reading.event;
      if (next.done) {
        // An early EOF with no live events can indicate a stalled connection; reconnect rather than
        // treating it as turn completion.
        this.closeLog('upstream-eof');
        break;
      }
      pending = pendingStreamRead(iterator);
      const event = next.value;
      // Previews bypass stored-event work but count toward the connection cap. Reconnection may lose
      // preview text; the buffered event preserves the real record.
      if (isPreviewEvent(event)) {
        this.liveCount += 1;
        this.life.livePreviews += 1;
        if (event.type === 'event_start' && event.event.type === 'agent.message')
          observeFirstToken(this.life, Date.now());
        const preview = translatePreviewEvent(event);
        if (preview) yield preview;
        continue;
      }
      if (this.seen.has(event.id)) {
        this.life.liveSeenSkips += 1;
        continue;
      }
      this.seen.add(event.id);
      this.liveCount += 1;
      this.life.liveForwarded += 1;
      const chat = await this.observeEvent(event);
      if (chat) yield { type: 'event', event: chat };
      if (isTerminalStreamEvent(event)) {
        this.completeTurn(event);
        yield { type: 'done', reason: 'terminal' };
        return;
      }
    }
    yield { type: 'done', reason: 'closed' };
  }

  private async observeEvent(event: BetaManagedAgentsSessionEvent) {
    const { sessionId, resolveGate } = this.input;
    observeLiveTurn(this.life, event);
    // Apply per-tool Allow/Block immediately so tools do not park unnecessarily. Gate outcomes still
    // wait for the user; history gates are handled before replay.
    let confirmation: 'allow' | 'deny' | undefined;
    if (
      (event.type === 'agent.tool_use' || event.type === 'agent.mcp_tool_use') &&
      event.evaluated_permission === 'ask'
    ) {
      const answer = await applyGatePolicy(
        this.client,
        sessionId,
        { toolUseId: event.id, toolName: event.name, toolInput: event.input },
        resolveGate,
      );
      if (answer === 'allow' || answer === 'deny') confirmation = answer;
    }
    scheduleMirror(this.work, sessionId, event);
    scheduleAccrual(this.work, sessionId, event);
    scheduleStatusSync(this.work, sessionId, event);
    scheduleIntegrationBrokenNotify(this.work, sessionId, event);
    const translated = translateEvent(event);
    observeSearchEvent(this.completedTurns, event, translated);
    const chat =
      translated?.kind === 'tool_use' && confirmation
        ? { ...translated, confirmation }
        : translated;
    // Inline file references mean an artifact already exists. Sweep before the client refetch; the
    // turn-end sweep also discovers unreferenced outputs.
    if (chat && 'fileRefs' in chat && chat.fileRefs && chat.fileRefs.length > 0)
      scheduleArtifactSweep(this.work, sessionId, 'single');
    return chat;
  }

  private completeTurn(event: BetaManagedAgentsSessionEvent): void {
    const { sessionId } = this.input;
    if (event.type === 'session.status_idle' && event.stop_reason.type === 'end_turn')
      scheduleSearchReconciliation(this.completedTurns, this.work, sessionId, event.id);
    reportTurnIntegrity(this.life, sessionId, event);
    // Provider file indexing can lag turn completion. The settle sweep polls in background without
    // holding the stream open.
    scheduleArtifactSweep(this.work, sessionId, 'relay-settle');
    scheduleTurnAnalytics(this.life, this.work, sessionId, event);
    this.closeLog('terminal');
  }

  private stopReason(): string | null {
    if (this.input.signal.aborted) return 'browser-disconnect';
    if (this.liveCount >= MAX_LIVE_EVENTS) return 'live-cap';
    if (Date.now() - this.startedAt >= RELAY_DEADLINE_MS) return 'deadline';
    return null;
  }

  // An unseen persisted event beyond the delivery grace means the live stream stalled. Reconnection
  // replays that gap; already-seen idle events need no reconnect.
  private async probeStall(): Promise<boolean> {
    try {
      return await isStreamStalled(this.client, this.input.sessionId, this.seen);
    } catch (error) {
      // A failed probe cannot establish a stall; retain the connection until its deadline.
      captureException(error, { sessionId: this.input.sessionId, op: 'relay-stall-probe' });
      return false;
    }
  }

  private closeLog(reason: string): void {
    if (this.phase === 'closed') return;
    relayConnectionMachine.assertCan(this.phase, 'closed');
    this.phase = 'closed';
    shipLog({
      msg: 'sessions.relay_closed',
      feature: 'sessions',
      op: 'relay',
      session_id: this.input.sessionId,
      reason,
      live_forwarded: this.life.liveForwarded,
      live_previews: this.life.livePreviews,
      live_seen_skips: this.life.liveSeenSkips,
      duration_ms: Date.now() - this.startedAt,
    });
  }
}
