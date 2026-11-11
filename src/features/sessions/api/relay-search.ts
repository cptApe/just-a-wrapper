import 'server-only';
import type { BetaManagedAgentsSessionEvent } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { CompletedTurnSearchCollector } from '../lib/session-search-text';
import type { ChatEvent } from '../types';
import type { RelayBackgroundWork } from './create-background-work';
import { reconcileSessionSearchText } from './session-search-text';

export function observeSearchEvent(
  completedTurns: CompletedTurnSearchCollector,
  event: BetaManagedAgentsSessionEvent,
  translated: ChatEvent | null,
): void {
  if (translated?.kind === 'message')
    completedTurns.observeMessage(translated.role, translated.text);
  if (event.type === 'session.status_idle')
    completedTurns.observeIdle(event.id, event.stop_reason.type);
  if (event.type === 'session.status_terminated') completedTurns.resetPendingTurn();
}
export function scheduleSearchReconciliation(
  completedTurns: CompletedTurnSearchCollector,
  work: RelayBackgroundWork,
  sessionId: string,
  expectedTerminalId?: string,
): void {
  const snapshot = completedTurns.snapshot();
  const latestTerminalEventId = snapshot.terminalEventIds.at(-1);
  if (
    !latestTerminalEventId ||
    (expectedTerminalId && expectedTerminalId !== latestTerminalEventId)
  )
    return;
  work.run('reconcile-session-search-text', () =>
    reconcileSessionSearchText({
      anthropicSessionId: sessionId,
      terminalEventIds: snapshot.terminalEventIds,
      latestTerminalEventId,
      searchText: snapshot.searchText,
    }),
  );
}
