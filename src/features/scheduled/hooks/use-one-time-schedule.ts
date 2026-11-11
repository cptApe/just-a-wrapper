import * as React from 'react';
import type { TriggerChoice } from '@/features/tasks/types';
import { parseOneTimeInput } from '../lib/one-time-input';
export function useOneTimeSchedule(
  onceValue: string,
  choice: TriggerChoice | null,
  timezone: string,
) {
  const runAt = choice === 'once' ? parseOneTimeInput(onceValue, timezone) : null;
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  return { runAt, now };
}
