import { cn } from '@/lib/utils';

// Nav-item state is MONOCHROME (accent green is reserved
// for links, primary buttons and focus): active = neutral fill pill +
// foreground medium; inactive = secondary text with a neutral hover tint.
export function navItemClasses(active: boolean): string {
  return cn(
    'flex h-11 w-full items-center gap-3 rounded-button px-3 text-body-lg',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    active
      ? 'bg-alpha-12 font-medium text-foreground'
      : 'font-medium text-foreground/80 hover:bg-alpha-6 hover:text-foreground',
  );
}

// Collapsed-rail icon item: navItemClasses with the label hidden — a 44px
// circle, same monochrome states. `data-rail-item` marks it a real control so
// the rail's background open-affordance ignores it.
export function railItemClasses(active: boolean): string {
  return cn(
    'flex size-11 items-center justify-center rounded-button',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    active
      ? 'bg-alpha-12 text-foreground'
      : 'text-foreground/80 hover:bg-alpha-6 hover:text-foreground',
  );
}
