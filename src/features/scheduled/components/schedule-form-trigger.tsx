'use client';

import { IconTrash01 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { EventSelection, TriggerChoice } from '@/features/tasks/types';
import type { BuilderValues, ScheduleBuilderModel } from '../lib/schedule-form-machine';
import { EventTriggerPicker } from './event-trigger-picker';
import { OneTimeTrigger } from './one-time-trigger';
import { ScheduleBuilder } from './schedule-builder';
import { TriggerPicker } from './trigger-picker';

export function ScheduleFormTrigger({
  choice,
  setChoice,
  isEdit,
  onceValue,
  setOnceValue,
  timezone,
  oneOffValid,
  builder,
  editBuilder,
  preferredEventType,
  eventSel,
  setEventSel,
}: {
  choice: TriggerChoice | null;
  setChoice: (value: TriggerChoice | null) => void;
  isEdit: boolean;
  onceValue: string;
  setOnceValue: (value: string) => void;
  timezone: string;
  oneOffValid: boolean;
  builder: ScheduleBuilderModel | null;
  editBuilder: (values: Partial<BuilderValues>) => void;
  preferredEventType: string | null;
  eventSel: EventSelection | null;
  setEventSel: (value: EventSelection | null) => void;
}) {
  return (
    <>
      {choice === null ? (
        <TriggerPicker
          onChange={(next) => {
            setChoice(next);
          }}
        />
      ) : (
        <div className="relative">
          {!isEdit && (
            <Button
              type="button"
              variant="ghost"
              aria-label="Remove trigger"
              className="absolute right-1 top-1 z-10 size-11 text-muted-foreground hover:text-destructive"
              onClick={() => setChoice(null)}
            >
              <IconTrash01 className="size-4" />
            </Button>
          )}
          <div>
            {choice === 'once' ? (
              <OneTimeTrigger
                onRepeat={setChoice}
                value={onceValue}
                onChange={setOnceValue}
                timezone={timezone}
                valid={oneOffValid}
              />
            ) : builder ? (
              <ScheduleBuilder
                builder={builder}
                onEdit={editBuilder}
                onOnce={() => setChoice('once')}
                timezone={timezone}
              />
            ) : (
              <EventTriggerPicker
                value={eventSel}
                onChange={setEventSel}
                preferredEventType={preferredEventType}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
