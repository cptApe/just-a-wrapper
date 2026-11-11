'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as React from 'react';
import { IconCheck, IconChevronRight } from '@/components/icons';
import { cn } from '@/lib/utils';
import { FLOATING_EDGE_GAP } from './lib/floating';

// The floating menu: a 240px dark-glass panel in BOTH themes. The glass-*
// tokens live in globals.css and deliberately have no .dark override.

// The one glass surface, defined once. Menus consume it through
// DropdownMenuContent below. A rich *widget* panel that legitimately needs
// non-menu ARIA (e.g. the notifications feed, whose All/Unread tablist cannot
// live inside a role="menu") may import and apply this same constant on a
// Popover so its surface stays byte-identical — never re-declare these tokens
// at a call site (see menu-README.md "Surface tokens").
export const menuSurfaceClasses = cn(
  'z-dialog min-w-[240px] overflow-hidden rounded-xl p-2',
  'bg-glass-bg text-glass-fg backdrop-blur-2xl shadow-glass',
);

// The menu sizes its own icons (16px, normal stroke) so callers can't drop a
// 24px/stroke-2 default in here.
//
// Item radius follows the concentric rule: item radius = container radius −
// container padding. The surface is rounded-xl with p-2 (8px), so items are
// rounded-lg. Keep these in lockstep if the surface radius/padding change
// (see menu-README.md). Label sizing is text-body (15px) — the app-wide menu
// item size; do not shrink per call site.
const menuItemClasses = cn(
  'relative flex h-9 max-sm:h-10 select-none items-center gap-2.5 rounded-lg px-2.5',
  'text-body font-medium outline-none',
  'focus:bg-glass-bg-hover',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  "[&_svg:not([class*='size-'])]:size-[18px] [&_svg]:shrink-0 [&_svg:not([class*='text-'])]:text-glass-fg-secondary [&_svg]:stroke-[1.5]",
);

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      menuItemClasses,
      'data-[state=open]:bg-glass-bg-hover',
      inset && 'pl-8',
      className,
    )}
    {...props}
  >
    {children}
    <IconChevronRight className="ml-auto size-4" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger';

export const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, collisionPadding = FLOATING_EDGE_GAP, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    collisionPadding={collisionPadding}
    className={cn(menuSurfaceClasses, className)}
    {...props}
  />
));
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent';

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, collisionPadding = FLOATING_EDGE_GAP, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        // z-dialog, not z-dropdown — menus open from inside sheets/dialogs;
        // same layer + DOM order keeps them on top (see ui/popover.tsx).
        menuSurfaceClasses,
        'origin-[var(--radix-dropdown-menu-content-transform-origin)]',
        // animation-duration-*, never duration-*: duration-* also sets
        // transition-duration, which slides the transform origin from the
        // panel's centre to its anchor while the panel scales in.
        'animation-duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
        'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(menuItemClasses, inset && 'pl-8', className)}
    {...props}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

// Action-row-as-menu-item. A menu can hold styled action buttons/links (the
// credits popover's Upgrade) that must NOT look like standard list
// rows but MUST still join the menu's roving focus so the keyboard can reach
// and activate them. This wraps the caller's own <Button>/<Link> (asChild) as a
// real Radix menu item: role="menuitem", roving tabindex, Enter/Space → click.
// It carries no list-row chrome — the child keeps its own look. See
// menu-README.md ("action rows as menu items").
export const DropdownMenuActionItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>((props, ref) => <DropdownMenuPrimitive.Item ref={ref} asChild {...props} />);
DropdownMenuActionItem.displayName = 'DropdownMenuActionItem';

// Selection item with a TRAILING check (house convention): the checkmark sits on
// the right edge, so unselected rows get no phantom leading indent and the label
// starts flush like every other item. `checked=false` still renders the glyph at
// opacity-0 so toggling selection never shifts the row. Use this for any
// single-select menu (tier picker, access selector, …) instead of hand-rolling a
// leading IconCheck; multi-line items just pass `items-start` in className.
//
// `self-center` keeps the check vertically centred against the WHOLE item even
// when the row is `items-start` (multi-line title + description) — the text stays
// top-aligned, the check floats to the middle. size-5 is the shared check size.
export const DropdownMenuCheckItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    checked?: boolean;
  }
>(({ className, children, checked = false, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    role="menuitemradio"
    aria-checked={checked}
    className={cn(menuItemClasses, className)}
    {...props}
  >
    {children}
    <IconCheck
      aria-hidden={!checked}
      className={cn('ml-auto size-5 shrink-0 self-center', checked ? 'opacity-100' : 'opacity-0')}
    />
  </DropdownMenuPrimitive.Item>
));
DropdownMenuCheckItem.displayName = 'DropdownMenuCheckItem';

// Radix checkbox/radio items follow the same trailing-check convention as
// DropdownMenuCheckItem: the label starts flush at the item's own px-2.5 (no
// leading indicator, so no phantom indent) and the selection mark sits on the
// right edge. Radix keeps the semantics — role="menuitemradio" /
// "menuitemcheckbox", aria-checked, roving focus, Enter/Space — and its
// ItemIndicator mounts the glyph only while the item is checked, so the visual
// mark can never disagree with aria-checked.
//
// The slot is always rendered at the shared size-5 check size, so toggling
// selection never shifts the row. The label wrapper is a shrinkable flex item
// (min-w-0 + truncate) so a long label clips before it can reach the check
// instead of pushing it or wrapping past the fixed h-9 row.
const menuItemLabelClasses = 'flex min-w-0 flex-1 items-center gap-2 truncate';

function MenuItemSelectionMark() {
  return (
    <span
      aria-hidden
      className="ml-auto flex size-5 shrink-0 items-center justify-center self-center"
    >
      <DropdownMenuPrimitive.ItemIndicator>
        <IconCheck className="size-5" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
  );
}

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    checked={checked}
    className={cn(menuItemClasses, className)}
    {...props}
  >
    <span className={menuItemLabelClasses}>{children}</span>
    <MenuItemSelectionMark />
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

export const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem ref={ref} className={cn(menuItemClasses, className)} {...props}>
    <span className={menuItemLabelClasses}>{children}</span>
    <MenuItemSelectionMark />
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem';

export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      'px-2.5 py-1.5 text-meta font-medium text-glass-fg-secondary',
      inset && 'pl-8',
      className,
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('-mx-2 my-1.5 h-px bg-glass-separator', className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';
