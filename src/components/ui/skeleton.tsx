import { cn } from '@/lib/utils';

/**
 * Plain pulse — no shimmer sweep. Restraint over signature; the sweep
 * reads "AI app" and we'd rather it didn't.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-sm bg-alpha-8', className)} {...props} />;
}

/**
 * Pulses behind transparent sample copy. The copy wraps exactly where the real
 * line wraps, so long values reserve the right number of lines at any width.
 * Place it inside an element carrying the real text style.
 */
export function SkeletonText({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="animate-pulse rounded-sm bg-alpha-8 text-transparent box-decoration-clone"
    >
      {children}
    </span>
  );
}
