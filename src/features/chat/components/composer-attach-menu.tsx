'use client';

import { toast } from 'sonner';
import { IconBookOpen01, IconGrid01, IconPlus, IconUpload01 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Attach offers native upload, Library and skills pickers without submenus.
// Show picker entries only when wired. Open downward and let Radix flip
// upward when the bottom-pinned composer needs room. When uploads are off the
// menu still opens, because Library and skills do not need them.

export function ComposerAttachMenu({
  disabled,
  disabledReason,
  onPickFromComputer,
  onOpenLibrary,
  onOpenSkills,
}: {
  disabled?: boolean;
  disabledReason?: string | null;
  onPickFromComputer: () => void;
  /** Opens the Library canvas; omit to hide the entry. */
  onOpenLibrary?: () => void;
  /** Opens the skills canvas; omit to hide the entry. */
  onOpenSkills?: () => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Add files and more"
              className="max-md:size-11"
              data-testid="composer-attach"
            >
              <IconPlus className="size-[18px]" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{disabledReason ?? 'Add files and more'}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="w-60 max-md:[&_[role=menuitem]]:min-h-11"
      >
        <DropdownMenuItem
          onSelect={() => {
            if (disabled) toast.error(disabledReason ?? 'File uploads aren’t available right now.');
            else onPickFromComputer();
          }}
          aria-disabled={disabled}
          className={disabled ? 'text-muted-foreground' : undefined}
          data-testid="attach-from-computer"
        >
          <IconUpload01 className="size-4" />
          Upload a file
        </DropdownMenuItem>

        {onOpenLibrary ? (
          <DropdownMenuItem onSelect={onOpenLibrary} data-testid="attach-from-library">
            <IconBookOpen01 className="size-4" />
            Add from library
          </DropdownMenuItem>
        ) : null}

        {onOpenSkills ? (
          <DropdownMenuItem onSelect={onOpenSkills} data-testid="attach-skill">
            <IconGrid01 className="size-4" />
            Use skills
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
