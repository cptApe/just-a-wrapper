import type { UsageEventRow } from '@/features/billing';
import type { TimeFormat } from '@/lib/format/display-format';
import { formatClock } from '@/lib/format/format-date';

// The log's display model plus the event-type vocabulary shared by the type
// split, the log, and the CSV. The server loader maps reader rows to this shape
// (UTC, matching the chart's UTC day buckets, in the reader's clock), so the
// client island renders strings verbatim.

// Friendly labels for the usage_event.event_type slugs the accrual path emits.
// Unknown types fall back to the raw slug rather than dropping the spend.
const EVENT_TYPE_LABELS: Record<string, string> = {
  model_request: 'Model usage',
  container_runtime: 'Computer runtime',
  tool_call: 'External tools',
  voice_transcription: 'Voice input',
  voice_tts: 'Voice output',
  title_generation: 'Chat titles',
};

export function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}

export type UsageLogItem = {
  id: string;
  /** UTC day bucket (`YYYY-MM-DD`) — the log groups by the chart's day. */
  day: string;
  /** Time of day within the UTC bucket, e.g. `9:14 AM` or `09:14`. */
  timeLabel: string;
  /** Full timestamp for the CSV export. */
  atIso: string;
  eventType: string;
  credits: number;
  platformPaid: boolean;
  sessionId: string | null;
  sessionTitle: string | null;
  /** Display identity of the member the event attributes to (name, else email). */
  member: string | null;
};

export function toUsageLogItem(row: UsageEventRow, timeFormat: TimeFormat): UsageLogItem {
  return {
    id: row.id,
    day: row.at.toISOString().slice(0, 10),
    timeLabel: formatClock(row.at, { timeZone: 'UTC', timeFormat }),
    atIso: row.at.toISOString(),
    eventType: row.eventType,
    credits: row.credits,
    platformPaid: row.platformPaid,
    sessionId: row.sessionId,
    sessionTitle: row.sessionTitle,
    member: row.memberName || row.memberEmail || null,
  };
}
