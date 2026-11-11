'use client';

import {
  IconCheck,
  IconGlobe01,
  IconLink01,
  IconLock01,
  IconShare01,
  IconUsers01,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCopy } from '@/components/ui/hooks/use-copy';
import { useMediaQuery } from '@/hooks/use-media-query';
import { activeShareChoice, useSessionShare } from '../hooks/use-session-share';

export function ShareMenu({ sessionId }: { sessionId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" data-testid="share-menu">
          <IconShare01 className="size-4" />
          Share
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ShareMenuItems key={sessionId} sessionId={sessionId} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ShareSubmenu({
  sessionId,
  disabled,
  className,
}: {
  sessionId: string;
  disabled?: boolean;
  className?: string;
}) {
  // A phone has no room beside a menu for a submenu (Radix can only flip it
  // left or right, so it clips), so the choices sit inline under a label.
  const phone = useMediaQuery('(width < 48rem)', false);
  if (phone) {
    return (
      <>
        <DropdownMenuSeparator />
        {disabled ? (
          <DropdownMenuItem disabled>
            <IconLock01 className="size-4" />
            Share
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuLabel>Share</DropdownMenuLabel>
            <ShareMenuItems key={sessionId} sessionId={sessionId} />
          </>
        )}
      </>
    );
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled} className={className}>
        {disabled ? <IconLock01 className="size-4" /> : <IconShare01 className="size-4" />}Share
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          <ShareMenuItems key={sessionId} sessionId={sessionId} />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

function ShareMenuItems({ sessionId }: { sessionId: string }) {
  // Menu content mounts on open, so each entry point reads current server state.
  const share = useSessionShare(sessionId);
  const link = useCopy({
    // The public link once it exists; otherwise the task's own address, for teammates.
    getText: () =>
      share.publicUrl ?? new URL(`/app/task/${sessionId}`, window.location.origin).href,
    op: 'copy-task-link',
    context: { sessionId },
    successToast: undefined,
    failureToast: 'Could not copy link. Try again.',
  });

  if (share.query.isError) {
    return (
      <>
        <DropdownMenuItem disabled>Couldn&apos;t load sharing</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void share.query.refetch();
          }}
        >
          Try again
        </DropdownMenuItem>
      </>
    );
  }
  if (!share.query.data) {
    return <DropdownMenuItem disabled>Loading…</DropdownMenuItem>;
  }

  const choice = activeShareChoice(
    share.query.data.share !== null,
    share.query.data.visibility === 'workspace',
  );
  const saving = share.pending;
  const copied = link.copyState === 'copied';
  function selectChoice(next: string) {
    if (saving || next === choice) return;
    link.reset();
    if (next === 'public' || next === 'team' || next === 'private') void share.setChoice(next);
  }

  function copyLink() {
    // A public choice whose link is still being made has nothing to copy yet.
    if (choice === 'public' && share.publicUrl === null) return;
    link.copy();
  }

  return (
    <>
      <DropdownMenuRadioGroup
        value={choice}
        onValueChange={selectChoice}
        aria-label="Sharing access"
      >
        <DropdownMenuRadioItem
          value="private"
          disabled={saving}
          onSelect={(event) => event.preventDefault()}
        >
          <IconLock01 className="size-4" />
          Only me
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          value="team"
          disabled={saving}
          onSelect={(event) => event.preventDefault()}
        >
          <IconUsers01 className="size-4" />
          Shared with team
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          value="public"
          disabled={saving}
          onSelect={(event) => event.preventDefault()}
        >
          <IconGlobe01 className="size-4" />
          Public access
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      {choice !== 'private' && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={saving}
            onSelect={(event) => {
              event.preventDefault();
              copyLink();
            }}
          >
            {copied ? <IconCheck className="size-4" /> : <IconLink01 className="size-4" />}
            <span aria-live="polite">{copied ? 'Copied' : 'Copy link'}</span>
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
