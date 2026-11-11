/** What the relay measured for the turn that just ended. */
export type CompletedTurn = {
  startedAt: number;
  firstTokenAt: number | null;
  endedAt: number;
  replies: number;
  modelRequests: number;
  interrupted: boolean;
  terminated: boolean;
  /** The start came from history (mixed clocks), so ttft_ms is approximate. */
  startEstimated: boolean;
};

export type TurnSpendRow = { eventType: string; credits: number };

export type TurnSpend = {
  credits: number;
  credits_model: number;
  credits_tools: number;
  credits_runtime: number;
  credits_voice: number;
};

/** Pure: the properties of one session:turn_complete event. */
export function turnCompleteProperties(turn: CompletedTurn): Record<string, unknown> {
  return {
    ttft_ms: turn.firstTokenAt === null ? null : turn.firstTokenAt - turn.startedAt,
    duration_ms: turn.endedAt - turn.startedAt,
    reply_count: turn.replies,
    model_request_count: turn.modelRequests,
    is_interrupted: turn.interrupted,
    // A user Stop before the first reply is a choice, not a failure (the relay's
    // own tripwire draws the same line).
    is_error: turn.terminated || (turn.replies === 0 && !turn.interrupted),
    is_start_estimated: turn.startEstimated,
  };
}

/** Pure: sum a turn's usage rows into the credit_spend breakdown. Reconciliation
 * rows share the model_request type, so they land in credits_model. */
export function spendBreakdown(rows: readonly TurnSpendRow[]): TurnSpend {
  const spend: TurnSpend = {
    credits: 0,
    credits_model: 0,
    credits_tools: 0,
    credits_runtime: 0,
    credits_voice: 0,
  };
  for (const row of rows) {
    if (row.credits <= 0) continue;
    spend.credits += row.credits;
    if (row.eventType === 'model_request') spend.credits_model += row.credits;
    else if (row.eventType === 'tool_call' || row.eventType === 'generation')
      spend.credits_tools += row.credits;
    else if (row.eventType === 'container_runtime') spend.credits_runtime += row.credits;
    else if (row.eventType === 'voice_tts') spend.credits_voice += row.credits;
  }
  return spend;
}
