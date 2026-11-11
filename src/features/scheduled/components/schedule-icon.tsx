'use client';

import { useState } from 'react';
import {
  IconActivity,
  IconActivityHeart,
  IconAirplay,
  IconAirpods,
  IconAlarmClockCheck,
  IconAlarmClockMinus,
  IconAlarmClockOff,
  IconAlarmClockPlus,
  IconAlertCircle,
  IconAlertHexagon,
  IconAlertOctagon,
  IconAlertSquare,
  IconAlertTriangle,
  IconAlignBottom01,
  IconAlignBottom02,
  IconAlignCenter,
  IconAlignHorizontalCentre01,
  IconAlignHorizontalCentre02,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconAnchor,
  IconAnnotationAlert,
  IconAnnotationCheck,
  IconAnnotationDots,
  IconAnnotationHeart,
  IconAnnotationInfo,
  IconArchive,
  IconArrowBlockDown,
  IconArrowBlockLeft,
  IconArrowBlockRight,
  IconArrowBlockUp,
  IconArrowCircleBrokenDownLeft,
  IconAtom01,
  IconAtom02,
  IconAttachment01,
  IconAward01,
  IconAward02,
  IconBank,
  IconBankNote01,
  IconBankNote02,
  IconBankNote03,
  IconBarChart01,
  IconBarChart02,
  IconBarChart03,
  IconBarChart04,
  IconBarChart05,
  IconBatteryCharging01,
  IconBatteryCharging02,
  IconBox,
  IconBracketsCheck,
  IconBracketsEllipses,
  IconBracketsMinus,
  IconBracketsPlus,
  IconBracketsSlash,
  IconBus,
  IconCalendarDate,
  IconCamera01,
  IconCamera02,
  IconCamera03,
  IconCameraLens,
  IconCar01,
  IconCar02,
  IconCircle,
  IconClipboardAttachment,
  IconClipboardCheck,
  IconClipboardDownload,
  IconCloud01,
  IconCloud02,
  IconCloud03,
  IconCloudLightning,
  IconCompass01,
  IconCube01,
  IconCube02,
  IconCube03,
  IconFaceContent,
  IconFaceFrown,
  IconFaceHappy,
  IconFaceId,
  IconFaceIdSquare,
  IconFaceNeutral,
  IconFile02,
  IconFileLock01,
  IconFileLock02,
  IconFlag01,
  IconGlobe01,
  IconInbox01,
  IconTable,
  IconUsers01,
  IconZap,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { decodeTaskIcon, TASK_ICON_COLORS, TASK_ICON_NAMES } from '@/features/tasks/lib/task-icon';
import { cn } from '@/lib/utils';

const ICONS = {
  calendar: IconCalendarDate,
  inbox: IconInbox01,
  globe: IconGlobe01,
  table: IconTable,
  file: IconFile02,
  users: IconUsers01,
  flag: IconFlag01,
  zap: IconZap,
  'alert-circle': IconAlertCircle,
  'arrow-block-down': IconArrowBlockDown,
  'bar-chart01': IconBarChart01,
  'annotation-alert': IconAnnotationAlert,
  'brackets-check': IconBracketsCheck,
  'align-center': IconAlignCenter,
  atom01: IconAtom01,
  box: IconBox,
  'bank-note01': IconBankNote01,
  'activity-heart': IconActivityHeart,
  camera01: IconCamera01,
  'align-bottom01': IconAlignBottom01,
  bus: IconBus,
  airplay: IconAirplay,
  'face-id-square': IconFaceIdSquare,
  circle: IconCircle,
  'alarm-clock-check': IconAlarmClockCheck,
  'face-content': IconFaceContent,
  cloud01: IconCloud01,
  'alert-hexagon': IconAlertHexagon,
  'arrow-block-left': IconArrowBlockLeft,
  'bar-chart02': IconBarChart02,
  'annotation-check': IconAnnotationCheck,
  'brackets-ellipses': IconBracketsEllipses,
  'align-justify': IconAlignJustify,
  atom02: IconAtom02,
  'clipboard-attachment': IconClipboardAttachment,
  'bank-note02': IconBankNote02,
  activity: IconActivity,
  camera02: IconCamera02,
  'align-bottom02': IconAlignBottom02,
  car01: IconCar01,
  airpods: IconAirpods,
  'face-id': IconFaceId,
  cube01: IconCube01,
  'alarm-clock-minus': IconAlarmClockMinus,
  'face-frown': IconFaceFrown,
  cloud02: IconCloud02,
  'alert-octagon': IconAlertOctagon,
  'arrow-block-right': IconArrowBlockRight,
  'bar-chart03': IconBarChart03,
  'annotation-dots': IconAnnotationDots,
  'brackets-minus': IconBracketsMinus,
  'align-left': IconAlignLeft,
  award01: IconAward01,
  'clipboard-check': IconClipboardCheck,
  'bank-note03': IconBankNote03,
  anchor: IconAnchor,
  camera03: IconCamera03,
  'align-horizontal-centre01': IconAlignHorizontalCentre01,
  car02: IconCar02,
  'battery-charging01': IconBatteryCharging01,
  'file-lock01': IconFileLock01,
  cube02: IconCube02,
  'alarm-clock-off': IconAlarmClockOff,
  'face-happy': IconFaceHappy,
  cloud03: IconCloud03,
  'alert-square': IconAlertSquare,
  'arrow-block-up': IconArrowBlockUp,
  'bar-chart04': IconBarChart04,
  'annotation-heart': IconAnnotationHeart,
  'brackets-plus': IconBracketsPlus,
  'align-right': IconAlignRight,
  award02: IconAward02,
  'clipboard-download': IconClipboardDownload,
  bank: IconBank,
  archive: IconArchive,
  'camera-lens': IconCameraLens,
  'align-horizontal-centre02': IconAlignHorizontalCentre02,
  compass01: IconCompass01,
  'battery-charging02': IconBatteryCharging02,
  'file-lock02': IconFileLock02,
  cube03: IconCube03,
  'alarm-clock-plus': IconAlarmClockPlus,
  'face-neutral': IconFaceNeutral,
  'cloud-lightning': IconCloudLightning,
  'alert-triangle': IconAlertTriangle,
  'arrow-circle-broken-down-left': IconArrowCircleBrokenDownLeft,
  'bar-chart05': IconBarChart05,
  'annotation-info': IconAnnotationInfo,
  'brackets-slash': IconBracketsSlash,
  attachment01: IconAttachment01,
};

const COLOR_CLASSES = {
  green: 'bg-schedule-green hover:bg-schedule-green',
  orange: 'bg-schedule-orange hover:bg-schedule-orange',
  blue: 'bg-schedule-blue hover:bg-schedule-blue',
  emerald: 'bg-schedule-emerald hover:bg-schedule-emerald',
  violet: 'bg-schedule-violet hover:bg-schedule-violet',
  pink: 'bg-schedule-pink hover:bg-schedule-pink',
  amber: 'bg-schedule-amber hover:bg-schedule-amber',
  indigo: 'bg-schedule-indigo hover:bg-schedule-indigo',
  slate: 'bg-schedule-slate hover:bg-schedule-slate',
  red: 'bg-schedule-red hover:bg-schedule-red',
  yellow: 'bg-schedule-yellow hover:bg-schedule-yellow',
  cyan: 'bg-schedule-cyan hover:bg-schedule-cyan',
};
const DEFAULT_COLORS: Partial<Record<string, keyof typeof COLOR_CLASSES>> = {
  calendar: 'green',
  inbox: 'orange',
  globe: 'blue',
  table: 'emerald',
  file: 'violet',
  users: 'pink',
  flag: 'amber',
  zap: 'indigo',
};
function resolveIconColor(
  name: string | null,
  color: keyof typeof COLOR_CLASSES | null,
): keyof typeof COLOR_CLASSES {
  if (color) return color;
  if (name === null) return 'green';
  return DEFAULT_COLORS[name] ?? 'green';
}
export function scheduleIconColor(icon?: string | null) {
  const { name, color } = decodeTaskIcon(icon);
  return COLOR_CLASSES[resolveIconColor(name, color)];
}

export function ScheduleIcon({
  icon,
  triggerType,
  className,
}: {
  icon?: string | null;
  triggerType: string;
  className?: string;
}) {
  const { name } = decodeTaskIcon(icon);
  const Icon = name ? ICONS[name] : triggerType === 'event' ? IconZap : IconCalendarDate;
  return <Icon className={className} aria-hidden />;
}

export function ScheduleIconPicker({
  value,
  triggerType,
  onChange,
}: {
  value: string | null;
  triggerType: string;
  onChange: (icon: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selection = decodeTaskIcon(value);
  const selectedColor = resolveIconColor(selection.name, selection.color);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          aria-label="Choose schedule icon"
          className={cn('size-11 shrink-0 rounded-md text-on-media', scheduleIconColor(value))}
        >
          <ScheduleIcon icon={value} triggerType={triggerType} className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[378px] max-w-[calc(100vw-48px)] rounded-lg p-3 shadow-popover"
      >
        <div role="group" aria-label="Schedule icons" className="grid grid-cols-10 gap-0.5">
          {TASK_ICON_NAMES.map((name) => (
            <Button
              key={name}
              type="button"
              variant="ghost"
              aria-label={`${name.replaceAll('-', ' ')} icon`}
              aria-pressed={selection.name === name}
              className={cn('h-8 min-w-0 rounded-sm p-0', selection.name === name && 'bg-alpha-8')}
              onClick={() => onChange(`${name}:${selectedColor}`)}
            >
              <ScheduleIcon icon={name} triggerType={triggerType} className="size-4" />
            </Button>
          ))}
        </div>
        <div
          role="group"
          aria-label="Icon colors"
          className="mt-3 flex justify-between border-t border-border pt-3"
        >
          {TASK_ICON_COLORS.map((color) => (
            <Button
              key={color}
              type="button"
              variant="ghost"
              aria-label={`${color} icon color`}
              aria-pressed={selectedColor === color}
              className={cn(
                'size-4 rounded-full p-0',
                COLOR_CLASSES[color],
                selectedColor === color &&
                  'ring-1 ring-foreground ring-offset-2 ring-offset-popover',
              )}
              onClick={() =>
                onChange(
                  `${selection.name ?? (triggerType === 'event' ? 'zap' : 'calendar')}:${color}`,
                )
              }
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
