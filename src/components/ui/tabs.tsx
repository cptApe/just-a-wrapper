'use client';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { useActiveTabRect } from '@/hooks/use-active-tab-rect';
import { cn } from '@/lib/utils';

// Pill tabs switch views over the same content; line tabs use an underline.
// Both indicators measure the active trigger and update on selection or resize.
// Reduced motion collapses the transition to an instant change.

export const Tabs = TabsPrimitive.Root;

const tabsListVariants = cva('relative inline-flex items-center', {
  variants: {
    variant: {
      pill: 'h-9 gap-0.5',
      line: 'h-10 gap-6 border-b',
    },
  },
  defaultVariants: { variant: 'pill' },
});

interface TabsListProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>,
    VariantProps<typeof tabsListVariants> {}

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, variant, children, ...props }, forwardedRef) => {
  const localRef = React.useRef<HTMLDivElement | null>(null);
  const rect = useActiveTabRect(localRef);
  const resolved = variant ?? 'pill';

  return (
    <TabsPrimitive.List
      ref={(element) => {
        localRef.current = element;
        if (typeof forwardedRef === 'function') return forwardedRef(element);
        if (forwardedRef) forwardedRef.current = element;
      }}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {rect &&
        (resolved === 'pill' ? (
          // The soft-fill pill: the one fill in the control, sliding between
          // triggers on the bare page background.
          <span
            aria-hidden
            className={cn(
              'absolute inset-y-0 left-0 rounded-button bg-alpha-6',
              'transition-[transform,width] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]',
            )}
            style={{ width: rect.width, transform: `translateX(${rect.left}px)` }}
          />
        ) : (
          <span
            aria-hidden
            className={cn(
              'absolute -bottom-px left-0 h-0.5 bg-foreground',
              'transition-[transform,width] duration-200 ease-[var(--ease-out)]',
            )}
            style={{ width: rect.width, transform: `translateX(${rect.left}px)` }}
          />
        ))}
      {children}
    </TabsPrimitive.List>
  );
});
TabsList.displayName = 'TabsList';

const tabsTriggerVariants = cva(
  cn(
    'relative inline-flex items-center justify-center whitespace-nowrap select-none',
    'transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
  ),
  {
    variants: {
      variant: {
        pill: 'h-9 rounded-button px-4 text-title-card font-medium text-muted-foreground hover:text-foreground data-[state=inactive]:hover:bg-alpha-6 data-[state=active]:text-foreground',
        line: 'h-10 px-0.5 -mb-px text-body-lg font-semibold text-foreground-tertiary hover:text-foreground data-[state=active]:text-foreground',
      },
    },
    defaultVariants: { variant: 'pill' },
  },
);

interface TabsTriggerProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>,
    VariantProps<typeof tabsTriggerVariants> {}

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, variant, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(tabsTriggerVariants({ variant }), className)}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-md',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';
