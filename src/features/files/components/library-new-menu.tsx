// Use plain glyphs because the trigger signals creation; fit the dropdown to its short labels.
'use client';

import { useRef } from 'react';
import { toast } from 'sonner';
import {
  IconChevronDown,
  IconFile02,
  IconFolder,
  IconMagicWand01,
  IconUploadCloud01,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';

const NEW_MENU_WIDTH = 'min-w-[180px]';

export function FilesNewMenu({
  uploadOffReason,
  onPickFiles,
  onNewFolder,
  onNewNote,
}: {
  /** Set when storage is off: the items that need it stay and explain why on use. */
  uploadOffReason: string | null;
  onPickFiles: (files: File[]) => Promise<void>;
  onNewFolder: () => void;
  onNewNote: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void onPickFiles(files);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm">
            New
            <IconChevronDown className="size-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={NEW_MENU_WIDTH}>
          <DropdownMenuItem
            onSelect={() => {
              if (uploadOffReason !== null) toast.error(uploadOffReason);
              else inputRef.current?.click();
            }}
            aria-disabled={uploadOffReason !== null}
            className={uploadOffReason !== null ? 'text-muted-foreground' : undefined}
          >
            <IconUploadCloud01 className="size-4" /> Upload
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onNewFolder}>
            <IconFolder className="size-4" /> Folder
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              if (uploadOffReason !== null) toast.error(uploadOffReason);
              else onNewNote();
            }}
            aria-disabled={uploadOffReason !== null}
            className={uploadOffReason !== null ? 'text-muted-foreground' : undefined}
          >
            <IconFile02 className="size-4" /> Note
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Memory Edit opens Create a note in the current folder or Ask agent to edit it. */
export function MemoryEditMenu({
  onCreateNote,
  onAskAgent,
  canCreateNote,
  creatingNote,
  askingAgent,
  askDisabledReason,
  createDisabledReason,
}: {
  onCreateNote: () => void;
  onAskAgent: () => void;
  /** Why this store refuses edits (Workspace memory for a member); null when the agent may edit it. */
  askDisabledReason: string | null;
  /** Create-a-note is disabled in a read-only store (workspace member). */
  canCreateNote: boolean;
  creatingNote: boolean;
  askingAgent: boolean;
  createDisabledReason?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          disabled={creatingNote || askingAgent}
          aria-busy={creatingNote || askingAgent}
        >
          Edit
          {creatingNote ? (
            <Spinner className="size-3.5" aria-hidden />
          ) : (
            <IconChevronDown className="size-3.5" aria-hidden />
          )}
          {creatingNote ? <span className="sr-only">Creating note</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={NEW_MENU_WIDTH}>
        <DropdownMenuItem
          onSelect={onAskAgent}
          disabled={askingAgent || askDisabledReason !== null}
          title={askDisabledReason ?? undefined}
        >
          <IconMagicWand01 className="size-4" /> Ask agent
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onCreateNote}
          disabled={!canCreateNote}
          title={!canCreateNote ? createDisabledReason : undefined}
        >
          <IconFile02 className="size-4" /> Create a note
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
