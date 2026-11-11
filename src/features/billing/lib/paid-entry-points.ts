/** Every path that checks the spend gate (`api/spend-gate.ts`) before its provider work names itself
 *  with one of these. Turn continuations, native tools and chat titles spend without a gate: the
 *  session budget or the platform covers them. Section 7.1 of docs/spec/02-foundation.md has the table. */
export type GatedEntryPoint =
  | 'chat_start'
  | 'send'
  | 'resume'
  | 'run_now'
  | 'scheduled_run'
  | 'event_run'
  | 'tool'
  | 'dictation'
  | 'read_aloud';
