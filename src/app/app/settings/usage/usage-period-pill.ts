import { cn } from '@/lib/utils';

// The period pill face, shared by the live controls and their loading twin so
// the skeleton's buttons can never drift from the real ones.
export function usagePeriodPillClass(isActive: boolean, disabled = false): string {
  return cn(
    'inline-flex h-8 max-sm:h-9 max-sm:text-body items-center gap-1.5 rounded-button px-3 text-meta font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    isActive
      ? 'bg-alpha-6 text-foreground'
      : 'text-muted-foreground hover:bg-alpha-6 hover:text-foreground',
    disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground',
  );
}
