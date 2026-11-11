'use client';

// Run now is only offered for recurring schedules; one-offs and event triggers cannot use it.

import { useState } from 'react';
import {
  IconDotsHorizontal,
  IconEdit01,
  IconPause,
  IconPlay,
  IconRocket01,
  IconTrash01,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import type { TaskScheduledItem } from '@/features/tasks/types';
import { useScheduledMutations } from '../api/use-scheduled-mutations';

export function ScheduledTaskMenu({ task }: { task: TaskScheduledItem }) {
  const { busy, run, remove, pause, resume } = useScheduledMutations();
  const [deleteOpen, setDeleteOpen] = useState(false);
  // A missed run is exactly when Run now is wanted, so stale does not hide it.
  const canRunNow =
    task.triggerType === 'schedule' && task.runAt === null && task.state !== 'finished';
  // Finished schedules remain read-only. Pending one-offs support date edits.
  const canEdit = task.state !== 'finished' && task.state !== 'running';
  const inFlight = task.status === 'creating';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${task.title}`}
            disabled={busy || inFlight}
            className="shrink-0 pointer-coarse:size-11"
          >
            <IconDotsHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {canEdit ? (
            <DropdownMenuItem
              onSelect={() => openOverlay(buildOverlayHash('new-schedule', task.id, { edit: '1' }))}
            >
              <IconEdit01 className="size-4" />
              Edit
            </DropdownMenuItem>
          ) : null}
          {canEdit && (
            <DropdownMenuItem
              onSelect={() => (task.state === 'paused' ? resume(task.id) : pause(task.id))}
            >
              {task.state === 'paused' ? (
                <IconPlay className="size-4" />
              ) : (
                <IconPause className="size-4" />
              )}
              {task.state === 'paused' ? 'Resume' : 'Pause'}
            </DropdownMenuItem>
          )}
          {canRunNow ? (
            <DropdownMenuItem onSelect={() => run(task.id)}>
              <IconRocket01 className="size-4" />
              Run now
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <IconTrash01 className="size-4 text-destructive!" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Modal open={deleteOpen} onOpenChange={setDeleteOpen} size="sm">
        <ModalHeader>
          <ModalTitle>Delete schedule?</ModalTitle>
        </ModalHeader>
        <ModalContent>
          <ModalDescription>
            “{task.title}” will stop running. Past runs stay on the calendar.
          </ModalDescription>
        </ModalContent>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setDeleteOpen(false);
              remove(task.id);
            }}
          >
            Delete
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
