import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// The design system's one text shimmer: a lighter sweep moving left to right
// through the letters of a line that is still working ("Searching the web",
// "Thinking…"). Wraps the globals.css `shimmer` utility so every live line in
// the product moves the same way, and only when the user has not asked for
// reduced motion: under prefers-reduced-motion the sweep is not applied at all
// and the words stay plain, instead of freezing mid-gradient (the global
// reduced-motion rule zeroes animation durations, which would leave the
// background-clip gradient stuck at its first frame).
//
// `active` false renders the plain span, so a line can flip from live to
// settled in place without remounting.

export function ShimmerText({
  active = true,
  className,
  ...props
}: ComponentProps<'span'> & { active?: boolean }) {
  return <span className={cn(active && 'motion-safe:shimmer', className)} {...props} />;
}
