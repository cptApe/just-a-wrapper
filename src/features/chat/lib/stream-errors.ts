import type { EventStream } from '../hooks/use-event-stream';

// Relay messages can contain SDK responses, configuration names, and request
// details. Keep those in telemetry and translate the cause at the UI boundary.
// The toast carries one action button (Retry, or Sign in for lost access), so
// the message states the cause only and never repeats what the button says.
export function streamErrorMessage(error: NonNullable<EventStream['meta']['error']>): string {
  switch (error.code) {
    case 'ACCESS_LOST':
      return 'Your access to this task expired or changed.';
    case 'MISSING_KEY':
      return 'The AI service is not available right now.';
    default:
      return 'Couldn’t load new replies.';
  }
}
