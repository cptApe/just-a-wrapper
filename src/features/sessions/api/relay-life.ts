import { type RelayTurn, reduceRelayTurn } from '../lib/relay-turn-machine';
import 'server-only';
import type { BetaManagedAgentsSessionEvent } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import { AppError } from '@/lib/errors';
import { shipLog } from '@/lib/logger';
import { captureException } from '@/lib/observability';
import { statusForEvent } from '../lib/status-for-event';
import type { RelayBackgroundWork } from './create-background-work';
import { captureCompletedTurn } from './turn-analytics';

export type RelayLife = {
  liveForwarded: number;
  livePreviews: number;
  liveSeenSkips: number;
  turn: RelayTurn;
};

export function createRelayLife(): RelayLife {
  const life: RelayLife = {
    liveForwarded: 0,
    livePreviews: 0,
    liveSeenSkips: 0,
    turn: { phase: 'none' },
  };
  return life;
}

export function observeLiveTurn(life: RelayLife, event: BetaManagedAgentsSessionEvent): void {
  switch (event.type) {
    case 'user.message':
      life.turn = reduceRelayTurn(life.turn, {
        type: 'start',
        userEventId: event.id,
        at: Date.now(),
        estimated: false,
      });
      break;
    case 'agent.message':
      life.turn = reduceRelayTurn(life.turn, { type: 'reply', at: Date.now() });
      break;
    case 'span.model_request_end':
      life.turn = reduceRelayTurn(life.turn, { type: 'model' });
      break;
    case 'user.interrupt':
      life.turn = reduceRelayTurn(life.turn, { type: 'interrupt' });
      break;
    default:
      return;
  }
}

export function seedOpeningTurn(
  life: RelayLife,
  history: BetaManagedAgentsSessionEvent[],
  lastStatusEvent: BetaManagedAgentsSessionEvent | undefined,
): void {
  // Opening turn: its user.message is already in history when the relay
  // attaches, so seed the turn clock from the upstream timestamp when no
  // reply has followed it yet. Later turns are timed from the live tail.
  const lastUserIdx = history.findLastIndex((e) => e.type === 'user.message');
  const lastReplyIdx = history.findLastIndex((e) => e.type === 'agent.message');
  const lastStatus = lastStatusEvent ? statusForEvent(lastStatusEvent) : null;
  if (lastUserIdx > lastReplyIdx && lastStatus !== 'idle' && lastStatus !== 'terminated') {
    // processed_at marks upstream processing, not enqueue time. Until it exists, use attach time and
    // mark the mixed-clock timing as estimated.
    const opening = history.at(lastUserIdx);
    const processedAt =
      opening && 'processed_at' in opening && typeof opening.processed_at === 'string'
        ? Date.parse(opening.processed_at)
        : Number.NaN;
    life.turn = reduceRelayTurn(life.turn, {
      type: 'start',
      userEventId: null,
      at: Number.isFinite(processedAt) ? processedAt : Date.now(),
      estimated: true,
    });
  }
}

export function reportTurnIntegrity(
  life: RelayLife,
  sessionId: string,
  event: BetaManagedAgentsSessionEvent,
): void {
  // Capture turn ids when model billing closes without an assistant reply.
  // Interruptions can legitimately end without replies, so log those without error capture.
  if (life.turn.phase !== 'none' && life.turn.userEventId !== null && life.turn.replies === 0) {
    if (life.turn.phase === 'interrupted') {
      shipLog({
        msg: 'sessions.turn_interrupted_without_reply',
        feature: 'sessions',
        op: 'relay',
        session_id: sessionId,
        user_event_id: life.turn.userEventId,
        model_requests: life.turn.modelRequests,
        terminal_event_id: event.id,
      });
    } else {
      captureException(
        new AppError('UNEXPECTED', 'Live turn closed without an assistant reply', {
          sessionId,
          userEventId: life.turn.userEventId,
          modelRequests: life.turn.modelRequests,
          terminalEventId: event.id,
        }),
        { sessionId, op: 'relay-turn-without-reply' },
      );
    }
  }
}

export function scheduleTurnAnalytics(
  life: RelayLife,
  work: RelayBackgroundWork,
  sessionId: string,
  event: BetaManagedAgentsSessionEvent,
): void {
  if (life.turn.phase !== 'none') {
    // Turn analytics run as ordered background work so this relay's token
    // accruals have landed first; the claim on the terminal event id keeps
    // a second attached tab from capturing the same turn.
    const turn = {
      startedAt: life.turn.startedAt,
      firstTokenAt: life.turn.firstTokenAt,
      endedAt: Date.now(),
      replies: life.turn.replies,
      modelRequests: life.turn.modelRequests,
      interrupted: life.turn.phase === 'interrupted',
      terminated: event.type === 'session.status_terminated',
      startEstimated: life.turn.estimated,
    };
    const terminalEventId = event.id;
    work.run('analytics-turn-complete', async () => {
      await captureCompletedTurn({ anthropicSessionId: sessionId, terminalEventId, turn });
    });
    life.turn = reduceRelayTurn(life.turn, { type: 'close' });
  }
}

export function observeFirstToken(life: RelayLife, at: number): void {
  life.turn = reduceRelayTurn(life.turn, { type: 'token', at });
}
