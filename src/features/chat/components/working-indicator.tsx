import { Marker } from '@/components/ui/marker';
import { cn } from '@/lib/utils';

// Render one shimmering working word where the reply will appear.
// Share geometry with ThinkingBlock so working, thinking and reply swap in place.
// The status live region supplies an accessible label; visible text is aria-hidden.
export function WorkingIndicator({ delayed = false }: { delayed?: boolean }) {
  return (
    <Marker
      role="status"
      aria-label="The agent is working"
      className={cn(
        'w-fit px-1 py-1 text-body text-muted-foreground',
        // Late fade-in for the slot under finished reply text: invisible for
        // the delay (fill-mode-backwards), so a turn that settles within it
        // never flashes the word before the action row takes the slot.
        delayed &&
          'animate-in fade-in-0 duration-200 [animation-delay:600ms] [animation-fill-mode:backwards] motion-reduce:animate-none',
      )}
    >
      <span aria-hidden className="shimmer">
        Working…
      </span>
    </Marker>
  );
}
