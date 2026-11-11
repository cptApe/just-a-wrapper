import { reduceSearchTurn, type SearchTurn } from './search-turn-machine';
// Pure helpers for the bounded conversation-search corpus. Kept dependency-free
// so the live relay and the history reconciliation can be covered by the fast Node unit suite.

export const SESSION_SEARCH_TEXT_MAX_CHARS = 20_000;

export type CompletedTurnSearchSnapshot = {
  terminalEventIds: string[];
  searchText: string;
};

function cleanSearchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// Index only the user text and final assistant reply of completed turns. requires_action preserves
// the pending turn across tool confirmation.
export class CompletedTurnSearchCollector {
  readonly #terminalEventIds: string[] = [];
  #searchText: string | null = null;
  #turn: SearchTurn = { phase: 'empty' };

  observeMessage(role: 'user' | 'assistant', text: string): void {
    this.#turn = reduceSearchTurn(
      this.#turn,
      { type: role, text: cleanSearchText(text) },
      SESSION_SEARCH_TEXT_MAX_CHARS,
    );
  }

  observeIdle(eventId: string, stopReason: string): void {
    if (stopReason === 'requires_action') return;
    if (
      stopReason === 'end_turn' &&
      this.#turn.phase === 'replied' &&
      this.#turn.users.length > 0
    ) {
      this.#searchText = appendSessionSearchText(this.#searchText, [
        ...this.#turn.users,
        this.#turn.reply,
      ]);
      this.#terminalEventIds.push(eventId);
    }
    this.resetPendingTurn();
  }

  resetPendingTurn(): void {
    this.#turn = reduceSearchTurn(this.#turn, { type: 'reset' }, SESSION_SEARCH_TEXT_MAX_CHARS);
  }

  snapshot(): CompletedTurnSearchSnapshot {
    return {
      terminalEventIds: [...this.#terminalEventIds],
      searchText: this.#searchText ?? '',
    };
  }
}

/** Join non-empty message text and retain the newest end of the corpus. */
export function appendSessionSearchText(
  existing: string | null,
  messages: readonly string[],
): string {
  const segments = [existing ?? '', ...messages].map(cleanSearchText).filter(Boolean);
  return segments.join('\n\n').slice(-SESSION_SEARCH_TEXT_MAX_CHARS);
}
