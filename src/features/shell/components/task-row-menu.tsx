'use client';

import { useState } from 'react';
import {
  IconDotsHorizontal,
  IconPencil01,
  IconPin02,
  IconPin02Solid,
  IconTrash01,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
// Client entry: the chat barrel also exports server APIs.
import { DeleteTaskDialog } from '@/features/chat/components/delete-task-dialog';
import { ShareSubmenu } from '@/features/chat/components/share-menu';
import type { WorkspaceSessionListItem } from '@/features/sessions';
import { cn } from '@/lib/utils';
import type { TaskListActions } from '../hooks/use-task-list';

export function TaskRowMenu({
  task,
  actions,
  open,
  onOpenChange,
}: {
  task: WorkspaceSessionListItem;
  actions: TaskListActions;
  /** Controlled by the row so it can reserve the button's space while open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const pinned = task.favoritedAt !== null;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Actions for ${task.title || 'untitled task'}`}
            className={cn(
              // Hidden at rest, revealed on row hover / focus / while open.
              'text-muted-foreground transition-opacity duration-150 hover:text-foreground',
              open
                ? 'opacity-100'
                : // Coarse (touch) pointers can't hover — keep the kebab visible
                  // so the row's actions stay reachable; fine pointers keep the
                  // hover/focus reveal unchanged.
                  'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100',
            )}
            onClick={(e) => {
              // The row is a link — the trigger must not navigate.
              e.preventDefault();
            }}
          >
            <IconDotsHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48 max-md:w-60">
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <IconPencil01 className="size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.setFavorited(task.id, !pinned)}>
            {pinned ? <IconPin02Solid className="size-4" /> : <IconPin02 className="size-4" />}
            {pinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
          <ShareSubmenu sessionId={task.id} />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            {/* Explicit text-destructive: the menu's icon-colour rule only spares
                svgs that already carry a text- class, else this would go neutral. */}
            <IconTrash01 className="size-4 text-destructive" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        initialTitle={task.title ?? ''}
        onConfirm={(title) => actions.rename(task.id, title)}
      />

      <DeleteTaskDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={task.title}
        onConfirm={() => actions.remove(task.id)}
      />
    </>
  );
}

function RenameDialog({
  open,
  onOpenChange,
  initialTitle,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle: string;
  onConfirm: (title: string) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const canConfirm = title.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setTitle(initialTitle); // re-prime on every open
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm">
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canConfirm) return;
            onOpenChange(false);
            onConfirm(title.trim());
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Rename task</DialogTitle>
          </DialogHeader>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Task name"
            // This rename modal exists to edit one field, so focus belongs here.
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canConfirm}>
              Confirm
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
