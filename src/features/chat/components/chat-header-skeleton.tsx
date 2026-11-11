import { IconShare01 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { UNTITLED_SESSION_TITLE } from '@/features/sessions/lib/untitled-session-title';

// The header frame is stable even when task title and sharing rights are
// unknown. The title reserves text-body's 22px line plus 8px padding. Share
// uses the real button metrics; both its share and locked glyph occupy 16px.
export function ChatHeaderSkeleton() {
  return (
    <div className="mobile-top-inset flex items-center gap-1 px-3 py-2 md:px-4">
      {/* Drawer trigger (size-11) — <md only, mirroring the real header. */}
      <Skeleton className="-ml-2 size-11 shrink-0 rounded-button md:hidden" />
      {/* Title trigger: px-2 py-1 text-body, 30px tall. */}
      <span
        data-testid="task-title"
        className="min-w-0 max-w-[400px] truncate px-2 py-1 text-body font-medium"
      >
        {UNTITLED_SESSION_TITLE}
      </span>
      {/* Desktop bar actions: share (ghost sm) + files (icon-sm), md+ only. */}
      <div className="ml-auto hidden items-center gap-1 md:flex">
        <Button size="sm" variant="ghost" disabled>
          <IconShare01 className="size-4" />
          Share
        </Button>
        <Skeleton className="size-9 rounded-button" />
      </div>
      {/* New task (size-11) — <md only. */}
      <Skeleton className="ml-auto size-11 rounded-button md:hidden" />
    </div>
  );
}
