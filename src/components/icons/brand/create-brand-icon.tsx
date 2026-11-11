import { cn } from '@/lib/utils';

// Brand marks live apart from the Untitled UI set on purpose: they are third-party
// logos with fixed, single-path SOLID forms and their own fill winding, not line/
// solid UI glyphs. Sourced from Simple Icons (https://simpleicons.org), CC0 1.0 /
// public domain. Used only by the task-share popover's social share-intent buttons.
// Do not add UI glyphs here — those belong in ../line or ../solid.

interface BrandIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

export const createBrandIcon = (path: string) => {
  // eslint-disable-next-line react/display-name -- the generated icon inherits its exported factory name
  return ({ className, ...props }: BrandIconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      // Default (nonzero) fill rule — Simple Icons are authored for it; forcing
      // evenodd (the shared solid-icon factory does) would invert brand counters.
      className={cn('size-6', className)}
      aria-hidden
      {...props}
    >
      <path d={path} />
    </svg>
  );
};
