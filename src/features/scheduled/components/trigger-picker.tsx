'use client';

import { useState } from 'react';
import { IconClock, IconPlus } from '@/components/icons';
import { useConnectedAppsEnabled } from '@/components/providers/deployment-capabilities-provider';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { IntegrationLogo } from '@/features/integrations/components/integration-logo';
import type { TriggerChoice } from '@/features/tasks/types';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { REPEAT_OPTIONS } from '../lib/repeat-options';
import { SCHEDULE_CLOCK } from './schedule-control-styles';

const OPTIONS: readonly { value: TriggerChoice; label: string; detail: string }[] = [
  { value: 'once', label: 'Once', detail: 'On a chosen date and time' },
  ...REPEAT_OPTIONS,
];
export function TriggerPicker({ onChange }: { onChange: (choice: TriggerChoice) => void }) {
  const [open, setOpen] = useState(false);
  const connectedAppsEnabled = useConnectedAppsEnabled();
  const choose = (choice: TriggerChoice) => {
    onChange(choice);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          className="h-11 w-full justify-start gap-3 rounded-md bg-alpha-6 px-3.5 text-body font-normal text-muted-foreground inset-shadow-none hover:bg-alpha-8"
        >
          <IconPlus className="size-4" />
          Add trigger
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // The list never runs off a short phone screen: it caps at the space
        // Radix measures beside the trigger and scrolls inside that.
        className="max-h-[min(520px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg bg-popover p-3 shadow-popover"
      >
        <p className="px-1.5 py-2 text-meta text-muted-foreground">General</p>
        {OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            className="h-auto min-h-11 w-full justify-start gap-3 rounded-md px-1.5 py-2 text-left focus-visible:bg-schedule-blue focus-visible:text-on-media [&:focus-visible_.text-muted-foreground]:text-on-media"
            onClick={() => choose(option.value)}
          >
            <span className={SCHEDULE_CLOCK}>
              <IconClock aria-hidden />
            </span>
            <span>
              <span className="block text-title-card font-normal leading-6">{option.label}</span>
              <span className="block text-meta font-normal text-muted-foreground">
                {option.detail}
              </span>
            </span>
          </Button>
        ))}
        <p className="px-1.5 pb-2 pt-4 text-meta text-muted-foreground">Gmail</p>
        <Button
          type="button"
          variant="ghost"
          disabled={!connectedAppsEnabled}
          className="h-auto min-h-11 w-full justify-start gap-3 whitespace-normal rounded-md px-1.5 py-2 text-left focus-visible:bg-schedule-blue focus-visible:text-on-media [&:focus-visible_.text-muted-foreground]:text-on-media"
          onClick={() => choose('event')}
        >
          <IntegrationLogo slug="gmail" name="Gmail" logoUrl={null} size={28} />
          <span>
            <span className="block">New email</span>
            <span className="block text-meta font-normal text-muted-foreground">
              {connectedAppsEnabled
                ? 'When an email arrives in your inbox'
                : CAPABILITY_OFF_MESSAGES.connectedApps}
            </span>
          </span>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
