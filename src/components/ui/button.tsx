import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-medium select-none touch-manipulation max-sm:text-body',
    'transition-[background-color,box-shadow,color] duration-150 ease-[var(--ease-out)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    // Suppress press scaling while a popover or dropdown is open because the
    // floating layer tracks the trigger rectangle and would visibly move. Keys
    // off aria-expanded because a wrapping TooltipTrigger overwrites data-state.
    'active:scale-[0.97] aria-expanded:active:scale-100',
    "[&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        // The inset border stays in its slot so caller shadow-* or shadow-none utilities stack.
        secondary:
          'bg-transparent text-foreground inset-shadow-[0_0_0_1px_var(--color-alpha-16)] hover:bg-alpha-6',
        ghost: 'bg-transparent text-foreground hover:bg-alpha-6',
        destructive: 'bg-transparent text-destructive hover:bg-destructive/10',
        'destructive-solid': 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link: 'bg-transparent text-foreground underline-offset-4 hover:underline px-0',
      },
      // Phone tap targets: lg, default and icon buttons grow to 44px. sm and
      // xs are the header and toolbar sizes; they sit beside 36px search
      // fields and tabs, so on phones they are 36px tall too.
      size: {
        lg: 'h-11 px-5 text-title-card rounded-button max-sm:min-w-11',
        default: 'h-10 px-4 text-title-card rounded-button max-sm:min-h-11 max-sm:min-w-11',
        sm: 'h-9 px-3.5 text-meta rounded-button',
        xs: 'h-8 px-3 text-body font-medium rounded-button gap-1.5 max-sm:min-h-9',
        icon: 'size-10 rounded-button gap-0 max-sm:min-h-11 max-sm:min-w-11',
        'icon-sm': 'size-9 rounded-button gap-0 max-sm:min-h-11 max-sm:min-w-11',
        'icon-xs': 'size-8 rounded-button gap-0 max-sm:min-h-11 max-sm:min-w-11',
        // Quiet corner controls on cards and tiles. The glyph stays 28px so it
        // never crowds the card's text; an invisible ring stretches the touch
        // target to 44px.
        'icon-2xs':
          'relative size-7 rounded-full gap-0 pointer-coarse:after:absolute pointer-coarse:after:-inset-2',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
