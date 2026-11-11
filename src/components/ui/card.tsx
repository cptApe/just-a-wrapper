import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const cardVariants = cva('text-card-foreground', {
  variants: {
    variant: {
      // Dense list rows / stat strips. Subtle alpha fill, no border.
      surface: 'bg-alpha-6 rounded-md',
      // The default — testimonials, billing summaries, settings sections.
      content: 'bg-card border rounded-lg',
    },
  },
  defaultVariants: {
    variant: 'content',
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant, className }))} {...props} />
  ),
);
Card.displayName = 'Card';
