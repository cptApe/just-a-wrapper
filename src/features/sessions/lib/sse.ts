// Only Anthropic event frames set an SSE ID. Control frames must not overwrite the EventSource
// resume cursor.
import type { RelayFrame } from '../types';

/** Format one relay frame as an SSE message block (terminating double-newline included). */
export function encodeFrame(frame: RelayFrame): string {
  // JSON escaping keeps data on one SSE line even when message text contains newlines.
  const payload = JSON.stringify(frame);
  const lines: string[] = [`event: ${frame.type}`];
  // Only real Anthropic events advance the resume cursor.
  if (frame.type === 'event') lines.push(`id: ${frame.event.id}`);
  lines.push(`data: ${payload}`);
  return `${lines.join('\n')}\n\n`;
}
