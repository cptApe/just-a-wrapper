import type { Repeats } from '@/features/tasks/lib/build-cron';

export const REPEAT_OPTIONS: readonly { value: Repeats; label: string; detail: string }[] = [
  { value: 'hourly', label: 'Hourly', detail: 'Every hour within chosen hours' },
  { value: 'daily', label: 'Daily', detail: 'Every day at a chosen time' },
  { value: 'weekly', label: 'Weekly', detail: 'Every week on chosen days' },
  { value: 'monthly', label: 'Monthly', detail: 'Every month on chosen days' },
  { value: 'yearly', label: 'Yearly', detail: 'Every year on a chosen date' },
];
