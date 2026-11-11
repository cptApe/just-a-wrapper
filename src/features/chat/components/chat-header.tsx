'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  IconChevronDown,
  IconEdit05,
  IconFolder,
  IconLock01,
  IconPencil01,
  IconPin02,
  IconPin02Solid,
  IconTrash01,
} from '@/components/icons';
import { MobileNavButton } from '@/components/layouts/mobile-nav';
import { useOrganizationId, useViewer } from '@/components/providers/app-providers';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import type { WorkspaceSessionDetail } from '@/features/sessions';
import { displaySessionTitle } from '@/features/sessions/lib/title-prompt';
import { useAsyncAction } from '@/hooks/use-async-action';
import { cn } from '@/lib/utils';
import { useChatHeader } from '../hooks/use-chat-header';
import { DeleteTaskDialog } from './delete-task-dialog';
import { ShareMenu, ShareSubmenu } from './share-menu';

// Task header supports inline rename and the shared pin, rename and delete actions.
// Sharing and task-file preview live on the right.

type ChatHeaderProps = {
  sessionId: string;
  /** The session row at page load; null when the row isn't visible (fallback title). */
  session: WorkspaceSessionDetail | null;
  /**
   * The viewer created this task. Rename, pin, delete and share are owner-only,
   * so a teammate on a shared task gets a plain title and a locked Share.
   */
  canWrite: boolean;
};

export function ChatHeader({ sessionId, session, canWrite }: ChatHeaderProps) {
  const router = useRouter();
  const organizationId = useOrganizationId() ?? '';
  const viewer = useViewer();
  const header = useChatHeader(sessionId, session, organizationId, viewer?.id ?? null);
  const { title, pinned, togglePin } = header;
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const displayTitle = displaySessionTitle(title);
  function saveTitle(next: string) {
    setEditing(false);
    return header.saveTitle(next);
  }

  async function deleteTask() {
    if (await header.remove()) router.push('/app');
  }

  return (
    <div className="mobile-top-inset flex shrink-0 items-center gap-1 px-3 py-2 md:px-4">
      {/* <md this header is the page's ONLY top bar (the shell chrome bar stands
          down on /app/task/*), so it carries the drawer trigger. md:hidden keeps
          the desktop header identical. -ml-2 lines the glyph up with the shell
          bar's hamburger on every other page. */}
      <MobileNavButton className="-ml-2 md:hidden" />
      {/* The title caps at 400px no matter how wide the header is and
          the rename input stays the narrow w-64 on purpose: the sidebar shows
          only the first few words of a title, so the tight input nudges people
          toward short names. Both states keep the zero-shift box metrics. */}
      <div className="flex min-w-0 flex-1 items-center">
        {editing ? (
          <InlineRename initial={displayTitle} onCommit={saveTitle} />
        ) : !canWrite ? (
          <span
            className="min-w-0 max-w-[400px] truncate px-2 py-1 text-body font-medium max-md:hidden"
            data-testid="task-title"
          >
            {displayTitle}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-w-0 max-w-[400px] truncate rounded-md px-2 py-1 text-body font-medium hover:bg-alpha-6 max-md:hidden"
            title="Rename task"
            data-testid="task-title"
          >
            {displayTitle}
          </button>
        )}

        {/* Hidden while renaming: the input owns the row until commit/cancel. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Task actions"
              data-testid="task-menu"
              className={cn(
                // On a phone the title and chevron are one trigger (the menu
                // holds Rename), like ChatGPT; desktop keeps the title as the
                // rename button and the chevron as its own icon button.
                editing
                  ? 'hidden'
                  : 'max-md:h-11 max-md:w-auto max-md:min-w-0 max-md:justify-start max-md:gap-1 max-md:px-2',
                // A teammate's menu holds only the phone-width Share and Files items.
                !canWrite && 'md:hidden',
              )}
            >
              <span className="min-w-0 truncate text-body font-medium text-foreground md:hidden">
                {displayTitle}
              </span>
              <IconChevronDown className="size-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-44 max-md:w-60 max-md:[&_[role=menuitem]]:min-h-11"
          >
            {canWrite ? (
              <>
                <DropdownMenuItem disabled={header.pinBusy} onSelect={() => void togglePin()}>
                  {pinned ? (
                    <IconPin02Solid className="size-4" />
                  ) : (
                    <IconPin02 className="size-4" />
                  )}
                  {pinned ? 'Unpin' : 'Pin'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <IconPencil01 className="size-4" />
                  Rename
                </DropdownMenuItem>
              </>
            ) : null}
            {/* Share + Files ride the desktop bar (right cluster below); <md that
                cluster is hidden and they fold into this menu instead, so a
                phone header stays a single uncluttered bar. md:hidden — desktop
                menu is unchanged. On a phone Share renders inline with its own
                separator, so Files sits above it. */}
            <DropdownMenuItem
              className="md:hidden"
              onSelect={() =>
                openOverlay(buildOverlayHash('task-file', 'all', { session: sessionId }))
              }
            >
              <IconFolder className="size-4" />
              Files
            </DropdownMenuItem>
            <ShareSubmenu sessionId={sessionId} disabled={!canWrite} className="md:hidden" />
            {canWrite ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  <IconTrash01 className="size-4 text-destructive" />
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Desktop bar actions. <md these fold into the task-actions menu above,
          so the phone header stays a single bar. */}
      <div className="ml-auto hidden items-center gap-1 md:flex">
        {canWrite ? (
          <ShareMenu sessionId={sessionId} />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A disabled button swallows pointer events, so the tooltip needs a
                  focusable/hoverable wrapper. The span keeps the trigger live. */}
              <span tabIndex={0} data-testid="share-menu-locked">
                <Button type="button" variant="ghost" size="sm" disabled>
                  <IconLock01 className="size-4" />
                  Share
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">Only the task owner can share</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Files in this task"
              data-testid="task-files"
              onClick={() =>
                openOverlay(buildOverlayHash('task-file', 'all', { session: sessionId }))
              }
            >
              <IconFolder className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Files</TooltipContent>
        </Tooltip>
      </div>

      {/* New task — <md only. The shell chrome bar that normally carries this
          compose slot stands down on /app/task/*, so the always-one-tap New task
          action lives here on a phone. size-11 keeps the tap target ≥44px. */}
      <Button
        asChild
        type="button"
        variant="ghost"
        size="icon"
        className="ml-auto size-11 md:hidden"
      >
        <Link href="/app" aria-label="New task">
          <IconEdit05 className="size-5" />
        </Link>
      </Button>

      <DeleteTaskDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={title}
        onConfirm={() => void deleteTask()}
      />
    </div>
  );
}

function InlineRename({
  initial,
  onCommit,
}: {
  initial: string;
  onCommit: (next: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const commitRequest = useAsyncAction();
  function commit(next: string) {
    void commitRequest.run(async () => {
      onCommit(next);
    });
  }
  return (
    <Form
      onSubmit={(event) => {
        event.preventDefault();
        commit(value);
      }}
      className="contents"
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => commit(value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') commit(initial);
        }}
        // The row just entered edit mode, so focus belongs in its text field.
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Task name"
        // Identical box metrics to the static title button (px-2 py-1 text-body,
        // natural height) so glyphs hold their exact x AND y on rename. w-full +
        // min-w-0 fills the same capped title slot as the truncating display title
        // so neither state overflows into the actions cluster. The
        // Input base sets text-body-lg sm:text-body; the bare text-body only
        // replaces the base size, so the sm: slot needs its own override too.
        className="h-auto w-64 max-w-full max-md:min-h-11 max-md:text-body-lg rounded-md px-2 py-1 text-body font-medium sm:text-body"
        data-testid="task-title-input"
      />
    </Form>
  );
}
