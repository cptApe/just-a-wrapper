'use client';

import { IconBell01 } from '@/components/icons';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import {
  isTaskNotification,
  notificationChannels,
  TASK_NOTIFICATION_LABELS,
  TASK_NOTIFICATIONS,
  type TaskNotification,
} from '@/features/notifications/lib/task-notification';
import { useScheduleEmailEnabled } from './schedules-capability-provider';

// The schedule's own notification choice, saved on the task: Email +
// App, Email only, App only, Off. Email goes out for its runs whether or not the
// person is away; App is the in-app notification.

export function ScheduleNotifications({
  value,
  onChange,
}: {
  value: TaskNotification;
  onChange: (value: TaskNotification) => void;
}) {
  const emailEnabled = useScheduleEmailEnabled();
  const options = TASK_NOTIFICATIONS.filter(
    (option) => emailEnabled || !notificationChannels(option).email,
  );
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isTaskNotification(next)) onChange(next);
      }}
    >
      <SelectTrigger aria-label="Notification choice" className="h-11 w-full">
        <div className="flex min-w-0 items-center gap-2">
          <IconBell01 className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{TASK_NOTIFICATION_LABELS[value]}</span>
        </div>
      </SelectTrigger>
      <SelectContent className="w-[var(--radix-select-trigger-width)]">
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {TASK_NOTIFICATION_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
