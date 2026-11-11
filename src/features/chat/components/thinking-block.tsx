import { ShimmerText } from '@/components/ui/shimmer-text';

// Extended-thinking marker: it exists only while it is the live tail of a
// running turn, as an active "Thinking…" shimmer. Once thinking settles it
// renders nothing at all — no "Thought for Xs" residue, standalone or inside an
// expanded chain (the work's results are on screen; the duration adds nothing).
// Settled thinking items still count toward chain step totals; only the visual
// row is gone.
export const THINKING_LABEL = 'Thinking…';

export function ThinkingBlock() {
  // The same shimmer treatment as WorkingIndicator (one shared loader
  // pattern) — the working → thinking handoff swaps a word in place.
  return (
    <div
      role="status"
      aria-label="The agent is thinking"
      className="flex items-center gap-2 px-1 py-1 text-body text-muted-foreground"
    >
      <ShimmerText aria-hidden>{THINKING_LABEL}</ShimmerText>
    </div>
  );
}
