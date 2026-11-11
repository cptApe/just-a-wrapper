'use client';

// One dialog for creation and editing. Triggers map to the existing deployment
// and Gmail paths; unsupported provider options are intentionally absent.
// Template parameters seed a draft and never write until Save.

import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { Button } from '@/components/ui/button';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { OverlayComponentProps } from '@/features/overlays';
import { captureException } from '@/lib/observability-client';
import { fetchEditableTask } from '../api/fetch-editable-task';
import { scheduledQueryKeys } from '../api/keys';
import { loadScheduleSummary } from '../api/load-schedule-summary';
import { useCachedScheduledTasks } from '../api/use-scheduled-tasks';
import { parseScheduleTimezoneParam } from '../lib/scheduled-search-params';
import { findScheduleTemplate } from '../lib/templates';
import { ScheduleDetail } from './schedule-detail';
import { ScheduleForm } from './schedule-form';
import { ScheduleFormSection } from './schedule-form-section';

export function NewScheduleOverlay({ id, open, params, onClose }: OverlayComponentProps) {
  if (id) {
    return (
      <ScheduleDetailOverlay
        key={`${id}:${params.get('edit')}`}
        taskId={id}
        open={open}
        startEditing={params.get('edit') === '1'}
        onClose={onClose}
      />
    );
  }

  const template = findScheduleTemplate(params.get('template'));

  return (
    // The overlay host sits above the shell TooltipProvider, and ComposerAttachMenu
    // needs a provider.
    <TooltipProvider delayDuration={300}>
      <Modal
        open={open}
        size="default"
        className="max-w-[548px]"
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <ModalHeader>
          <ModalTitle>New schedule</ModalTitle>
        </ModalHeader>
        <ScheduleForm
          key={template?.id ?? 'blank'}
          initial={null}
          draft={template?.draft ?? null}
          defaultTimezone={parseScheduleTimezoneParam(params.get('tz'))}
          onClose={onClose}
        />
      </Modal>
    </TooltipProvider>
  );
}

function ScheduleDetailOverlay({
  taskId,
  open,
  startEditing,
  onClose,
}: {
  taskId: string;
  open: boolean;
  startEditing: boolean;
  onClose: () => void;
}) {
  const organizationId = useOrganizationId();
  const [editing, setEditing] = React.useState(startEditing);

  const query = useQuery({
    queryKey:
      organizationId !== null
        ? scheduledQueryKeys.detail(organizationId, taskId)
        : scheduledQueryKeys.unscoped(),
    queryFn: ({ signal }) => fetchEditableTask(taskId, signal),
    enabled: organizationId !== null,
  });

  React.useEffect(() => {
    if (query.error) captureException(query.error, { op: 'load-editable-task', taskId });
  }, [query.error, taskId]);

  // The Scheduled page seeds this cache; a cold overlay loads its own summary.
  const cachedSummary = useCachedScheduledTasks(organizationId)?.find((task) => task.id === taskId);
  const coldSummary = useQuery({
    queryKey:
      organizationId !== null
        ? scheduledQueryKeys.summary(organizationId, taskId)
        : scheduledQueryKeys.unscoped(),
    queryFn: () => loadScheduleSummary(taskId),
    enabled: organizationId !== null && cachedSummary === undefined,
  });
  React.useEffect(() => {
    if (coldSummary.error)
      captureException(coldSummary.error, { op: 'load-schedule-summary', taskId });
  }, [coldSummary.error, taskId]);
  const summary = cachedSummary ?? coldSummary.data ?? undefined;
  const summaryLoading = cachedSummary === undefined && coldSummary.isPending;
  const editable = query.data?.status === 'upcoming' || query.data?.status === 'paused';
  // `edit=1` on a row that turned out read-only (a finished one-off) falls back
  // to the detail view rather than showing a form that can't save.
  const showForm = editing && editable;

  return (
    <TooltipProvider delayDuration={300}>
      <Modal
        open={open}
        size="default"
        className="max-w-[548px]"
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        presentation="dialog"
      >
        <ModalHeader onBack={showForm ? () => setEditing(false) : undefined}>
          <ModalTitle>
            {showForm ? 'Edit schedule' : (query.data?.title ?? 'Schedule details')}
          </ModalTitle>
        </ModalHeader>
        {query.data && (showForm || !summaryLoading) ? (
          showForm ? (
            <ScheduleForm
              initial={query.data}
              draft={null}
              defaultTimezone={null}
              onClose={onClose}
            />
          ) : (
            <ScheduleDetail
              task={query.data}
              summary={summary}
              editable={editable}
              onEdit={() => setEditing(true)}
              onClose={onClose}
            />
          )
        ) : query.isError ? (
          <>
            <ModalContent>
              <p role="alert" className="py-6 text-center text-title-card text-muted-foreground">
                Couldn’t load this schedule.
              </p>
            </ModalContent>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={onClose}>
                Close
              </Button>
              <Button type="button" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </ModalFooter>
          </>
        ) : (
          <ScheduleFormSkeleton />
        )}
      </Modal>
    </TooltipProvider>
  );
}

function ScheduleFormSkeleton() {
  return (
    <ModalContent className="gap-5" aria-busy="true" aria-label="Loading schedule">
      <ScheduleFormSection title="Name">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-md" />
          <Skeleton className="h-10 flex-1 rounded-md" />
        </div>
      </ScheduleFormSection>
      <ScheduleFormSection title="When">
        <Skeleton className="h-8 w-56 rounded-button" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-44 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
        <Skeleton className="h-4 w-3/5" />
      </ScheduleFormSection>
      <ScheduleFormSection title="Instructions">
        <Skeleton className="h-[120px] w-full rounded-md" />
        <Skeleton className="h-3 w-4/5" />
      </ScheduleFormSection>
      <ScheduleFormSection title="Notification">
        <Skeleton className="h-9 w-full rounded-md" />
      </ScheduleFormSection>
    </ModalContent>
  );
}
