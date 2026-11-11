import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 font-medium tabular-nums whitespace-nowrap select-none',
  {
    variants: {
      shape: {
        chip: 'rounded-sm border-[1.5px] px-1.5 h-5 text-meta',
        pill: 'rounded-button px-2.5 h-6 text-meta font-medium',
      },
      variant: {
        default: 'border-foreground/30 text-foreground bg-transparent',
        outline: 'border-border text-muted-foreground bg-transparent',
        solid: 'border-foreground bg-foreground text-background',
        muted: 'border-transparent bg-alpha-8 text-muted-foreground',
        destructive: 'border-destructive/40 bg-destructive-soft text-destructive',
        success: 'border-success/40 bg-success-soft text-success',
        warning: 'border-warning/40 bg-warning-soft text-warning',
        info: 'border-info/40 bg-info-soft text-info',
      },
    },
    defaultVariants: {
      shape: 'chip',
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, shape, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ shape, variant }), className)} {...props} />;
}
