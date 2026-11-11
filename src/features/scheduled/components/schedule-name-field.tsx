'use client';

import { Input } from '@/components/ui/input';
import { ScheduleIconPicker } from './schedule-icon';

export function ScheduleNameField({
  icon,
  mode,
  setIcon,
  title,
  setTitle,
}: {
  icon: string | null;
  mode: 'schedule' | 'event';
  setIcon: (icon: string | null) => void;
  title: string;
  setTitle: (title: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <ScheduleIconPicker value={icon} triggerType={mode} onChange={setIcon} />
      <Input
        aria-label="Schedule name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Name this schedule"
        maxLength={200}
        autoComplete="off"
        // 44px on every width, level with the icon picker beside it.
        className="h-11 max-sm:h-11 min-w-0 flex-1"
      />
    </div>
  );
}
