'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { ModalContent, ModalFooter } from '@/components/ui/modal';
import type { AgentTier } from '@/features/agents/types';
import type { TaskNotification } from '@/features/notifications/lib/task-notification';
import { detectTimeZone } from '@/features/preferences/lib/time-preferences';
import { parseCron } from '@/features/tasks/lib/build-cron';
import { isOneOffInWindow } from '@/features/tasks/lib/is-one-off-in-window';
import type { EditableTask, TaskAttachments, TriggerChoice } from '@/features/tasks/types';
import { AppError } from '@/lib/errors';
import { isExpectedUserStateError } from '@/lib/expected-state-error';
import { captureException } from '@/lib/observability-client';
import { useSaveSchedule } from '../api/use-save-schedule';
import { useOneTimeSchedule } from '../hooks/use-one-time-schedule';
import { useScheduleAttachments } from '../hooks/use-schedule-attachments';
import { buildScheduleCreate, buildScheduleEdit } from '../lib/build-schedule-save';
import { formatOneTimeInput } from '../lib/one-time-input';
import {
  type BuilderValues,
  type ScheduleTriggerOrigin,
  scheduleFormReducer,
  triggerCron,
  triggerFor,
} from '../lib/schedule-form-machine';
import type { ScheduleTemplateDraft } from '../lib/templates';
import { ScheduleFormSection } from './schedule-form-section';
import { ScheduleFormTrigger } from './schedule-form-trigger';
import { ScheduleInstructions } from './schedule-instructions';
import { ScheduleNameField } from './schedule-name-field';
import { ScheduleNotifications } from './schedule-notifications';
import { useScheduleEmailEnabled } from './schedules-capability-provider';

export function ScheduleForm({
  initial,
  draft,
  defaultTimezone,
  onClose,
}: {
  initial: EditableTask | null;
  draft: ScheduleTemplateDraft | null;
  defaultTimezone: string | null;
  onClose: () => void;
}) {
  const isEdit = initial !== null;

  const [icon, setIcon] = React.useState<string | null>(
    initial ? (initial.icon ?? null) : (draft?.icon ?? null),
  );
  const timezone = resolveScheduleTimezone(initial?.timezone ?? null, defaultTimezone);
  const origin: ScheduleTriggerOrigin = {
    choice: initialTriggerChoice(initial, draft),
    savedCron: initial?.cron ?? null,
    seed: draft?.mode === 'schedule' ? draft.schedule : null,
  };
  const [trigger, dispatchTrigger] = React.useReducer(scheduleFormReducer, null, () =>
    triggerFor(
      origin.choice,
      origin,
      initial?.runAt ? formatOneTimeInput(new Date(initial.runAt), timezone) : '',
    ),
  );
  const choice =
    trigger.kind === 'none' ? null : trigger.kind === 'repeating' ? trigger.choice : trigger.kind;
  const mode: 'event' | 'schedule' = trigger.kind === 'event' ? 'event' : 'schedule';
  const cron = triggerCron(trigger);
  const eventSel = trigger.kind === 'event' ? trigger.selection : null;
  const onceValue = trigger.kind === 'once' ? trigger.value : '';
  const setChoice = (choice: TriggerChoice | null) =>
    dispatchTrigger({ type: 'choose', choice, origin });
  const setOnceValue = (value: string) => dispatchTrigger({ type: 'date', value });

  const [title, setTitle] = React.useState(initial ? initial.title : (draft?.title ?? ''));
  const [description, setDescription] = React.useState(
    initial ? initial.description : (draft?.prompt ?? ''),
  );
  const successCriteria = initial?.successCriteria ?? '';
  const [tier, setTier] = React.useState<AgentTier>(initial?.tier ?? 'default');
  const autoApprove = initial?.autoApprove ?? false;
  const emailEnabled = useScheduleEmailEnabled();
  const [notification, setNotification] = React.useState<TaskNotification>(
    initial?.notification ?? (emailEnabled ? 'email_app' : 'app'),
  );

  const attachmentsState = useScheduleAttachments(initial?.attachments ?? null);
  const { uploading } = attachmentsState;

  const { runAt, now } = useOneTimeSchedule(onceValue, choice, timezone);

  const oneOffValid = isOneOffInWindow(runAt, now);
  const canSubmit =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    // Event target is fixed on edit, so only create requires a fresh selection.
    choice !== null &&
    (choice === 'once'
      ? oneOffValid
      : mode === 'schedule'
        ? cron !== null
        : isEdit || eventSel !== null);

  const saveMutation = useSaveSchedule(onClose);

  const submit = async () => {
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedSuccessCriteria = successCriteria.trim();

    let attachments: TaskAttachments | null;
    try {
      attachments = await attachmentsState.upload();
    } catch (error) {
      if (!isExpectedUserStateError(error))
        captureException(error, { op: 'upload-schedule-attachments' });
      toast.error(error instanceof AppError ? error.message : 'Couldn’t attach files. Try again.', {
        description:
          error instanceof AppError && typeof error.context.description === 'string'
            ? error.context.description
            : undefined,
      });
      return;
    }

    const values = {
      trimmedTitle,
      trimmedDescription,
      trimmedSuccessCriteria,
      icon,
      mode,
      tier,
      autoApprove,
      notification,
      attachments,
      choice,
      runAt,
      cron,
      timezone,
      eventSel,
    };
    saveMutation.mutate(initial ? buildScheduleEdit(initial, values) : buildScheduleCreate(values));
  };

  return (
    <Form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !saveMutation.isPending && !uploading) void submit();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ModalContent className="gap-5">
        <ScheduleNameField {...{ icon, mode, setIcon, title, setTitle }} />
        <ScheduleFormSection title="Triggers">
          <ScheduleFormTrigger
            {...{
              choice,
              setChoice,
              isEdit,
              onceValue,
              setOnceValue,
              timezone,
              oneOffValid,
              builder: trigger.kind === 'repeating' ? trigger.builder : null,
              editBuilder: (values: Partial<BuilderValues>) =>
                dispatchTrigger({ type: 'edit', values }),
              preferredEventType:
                initial?.eventType ?? (draft?.mode === 'event' ? draft.eventType : null),
              eventSel,
              setEventSel: (value) => dispatchTrigger({ type: 'event', value }),
            }}
          />
        </ScheduleFormSection>
        <ScheduleFormSection title="Instructions">
          <ScheduleInstructions
            attachments={attachmentsState}
            {...{ description, setDescription, tier, setTier }}
          />
        </ScheduleFormSection>
        <ScheduleFormSection title="Notification">
          <ScheduleNotifications value={notification} onChange={setNotification} />
        </ScheduleFormSection>
      </ModalContent>
      <ModalFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit || saveMutation.isPending || uploading}>
          {uploading
            ? 'Attaching…'
            : saveMutation.isPending
              ? 'Saving…'
              : isEdit
                ? 'Save changes'
                : 'Save'}
        </Button>
      </ModalFooter>
    </Form>
  );
}

function resolveScheduleTimezone(stored: string | null, preferred: string | null): string {
  if (stored !== null) return stored;
  if (preferred !== null) return preferred;
  return detectTimeZone() || 'UTC';
}

function initialTriggerChoice(
  initial: EditableTask | null,
  draft: ScheduleTemplateDraft | null,
): TriggerChoice | null {
  if (initial?.runAt) return 'once';
  if (initial?.triggerType === 'event' || draft?.mode === 'event') return 'event';
  if (initial) return initial.cron ? (parseCron(initial.cron)?.repeats ?? 'daily') : 'daily';
  return draft?.mode === 'schedule' ? draft.schedule.repeats : null;
}
