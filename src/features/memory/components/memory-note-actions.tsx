'use client';

import {
  IconClockRewind,
  IconCornerUpRight,
  IconDotsHorizontal,
  IconPencil01,
  IconTrash01,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModalIconButton } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';

export function MemoryNoteActions({
  hasNote,
  canEdit,
  editing,
  saving,
  canSave,
  reloading,
  historyOpen,
  draftFormId,
  onStartEdit,
  onCancelEdit,
  onToggleHistory,
  onRename,
  onDelete,
}: {
  hasNote: boolean;
  canEdit: boolean;
  editing: boolean;
  saving: boolean;
  canSave: boolean;
  reloading: boolean;
  historyOpen: boolean;
  draftFormId: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onToggleHistory: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const actions = hasNote ? (
    <>
      {canEdit && !editing ? (
        <Button type="button" variant="secondary" size="xs" onClick={onStartEdit}>
          <IconPencil01 className="size-3.5" /> Edit
        </Button>
      ) : null}
      {editing ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onCancelEdit}
            disabled={saving || reloading}
          >
            Cancel
          </Button>
          <Button type="submit" form={draftFormId} size="xs" disabled={!canSave} aria-busy={saving}>
            {saving ? <Spinner aria-hidden /> : null}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      ) : null}
      <ModalIconButton
        label={historyOpen ? 'Hide history' : 'Show history'}
        onClick={onToggleHistory}
      >
        <IconClockRewind className="size-4" />
      </ModalIconButton>
      {canEdit && !editing ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ModalIconButton label="Note actions">
              <IconDotsHorizontal className="size-4" />
            </ModalIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRename}>
              <IconCornerUpRight className="size-4" /> Rename / move
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onDelete}
            >
              <IconTrash01 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  ) : undefined;

  return actions;
}
