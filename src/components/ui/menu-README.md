# Menus — the one transient surface

Every transient, click-triggered menu in the app is **one surface**: the
dark-glass `DropdownMenu` (`dropdown-menu.tsx`). The design system mandates it
(`docs/spec/08-design-system.md` §5 Components, "Menus"). Do not invent a
second menu look. If a menu drifts — different
background, radius, hover, or text size — that is a bug to refit, not a style.

## Surface tokens (defined once, in the primitive)

The surface lives in `menuSurfaceClasses` in `dropdown-menu.tsx` (exported). Call
sites must **not** re-declare it. Menus consume it through `DropdownMenuContent`;
a rich *widget* panel that legitimately needs non-menu ARIA (the notifications
feed, whose All/Unread tablist cannot live inside a `role="menu"`) imports the
same constant and applies it to a `Popover`, so its surface stays byte-identical
to every menu without re-declaring the tokens.

| Aspect | Token / value |
| --- | --- |
| Background | `bg-glass-bg` (dark in **both** app themes — the glass tokens have no `.dark` override) |
| Foreground | `text-glass-fg`; secondary `text-glass-fg-secondary`; tertiary `text-glass-fg-tertiary` |
| Blur | `backdrop-blur-2xl` |
| Shadow | `shadow-glass` (the one sanctioned menu shadow) |
| Radius | `rounded-xl` |
| Padding | `p-2` (8px) |
| Separator | `DropdownMenuSeparator` → `bg-glass-separator`, full-bleed (`-mx-2`) |
| Layer | `z-dialog` (menus open from inside sheets/dialogs; same layer + DOM order keeps them on top) |

Because the surface is dark in both themes, **use the `glass-fg*` tokens for
text, never `text-muted-foreground` / `text-foreground`** — those flip with the
app theme and go low-contrast on the always-dark glass. Buttons placed inside a
menu need glass-safe colors too (e.g. `bg-glass-fg text-neutral-900`), not the
default `primary` fill.

## The concentric radius rule

**Item radius = container radius − container padding.** With the surface at
`rounded-xl` and `p-2` (8px), items are `rounded-lg`. This keeps the
item corners visually concentric with the panel corners. It is encoded in
`menuItemClasses` with a comment — it is not a magic number. If you ever change
the surface radius or padding, recompute the item radius to match.

## Item anatomy

The base item (`menuItemClasses`, exported as `DropdownMenuItem`) is:

- `h-9`, `px-2.5`, `gap-2`, `rounded-lg`
- Label at `text-body` (**15px**) `font-medium` — the app-wide menu item size.
  Sized up from 14px for non-technical users with average eyesight. Do not
  shrink it per call site.
- Hover / keyboard highlight: `focus:bg-glass-bg-hover` (Radix drives the
  highlight through focus, so this covers pointer hover too). The hover is the
  **padded item background** — never a full-bleed row.
- Icons: forced to 16px, normal stroke, `text-glass-fg-secondary` by the
  primitive, so a caller can't drop a 24px/stroke-2 default in.

Slots, left to right: **leading icon (optional) · label · description (optional,
`text-meta` / `text-glass-fg-secondary`) · trailing accessory**.

Per-menu knobs that are allowed to vary: **width** (`w-72`, `w-80`, …) and
**item height** (e.g. `h-12` for avatar rows). The surface, radius math, hover
treatment, and label text size are **not** knobs.

## Checkmark is trailing — always

Selection is marked on the **right edge**, never a leading slot. This means
unselected rows get no phantom left indent and every label starts flush.

Use `DropdownMenuCheckItem` for single-select menus (tier picker, access
selector, …) instead of hand-rolling a leading `IconCheck`:

```tsx
<DropdownMenuCheckItem checked={value === option} onSelect={() => set(option)}>
  {option.label}
</DropdownMenuCheckItem>
```

- `checked={false}` still renders the glyph at `opacity-0`, so toggling
  selection never shifts the row (no layout shift).
- The check is `size-5` (the shared selection-check size across every menu) and
  `self-center`, so on multi-line items (pass `items-start` in `className` to
  top-align the title + description) the check stays vertically centred against
  the whole row rather than riding up to the first line.

`DropdownMenuRadioItem` / `DropdownMenuCheckboxItem` (Radix `RadioGroup` /
`CheckboxItem`) follow the same rule: the label starts flush at the item's own
`px-2.5` and the check sits in a trailing `size-5` slot that is always rendered,
with Radix's `ItemIndicator` mounting the glyph only while the item is checked.
Radix owns the semantics (`role="menuitemradio"` / `"menuitemcheckbox"`,
`aria-checked`, roving focus, Enter/Space), so the trailing check is a visual
selection mark, not a change in behaviour. The label is a shrinkable
`min-w-0 flex-1 truncate` wrapper, so a long label clips before it can reach the
check. Use them for filter facets (the funnel menus) and other grouped pickers
where a `value` + `onValueChange` group is the natural shape; use
`DropdownMenuCheckItem` when the caller already holds a boolean `checked`.

## Action rows as menu items

A menu can hold styled action buttons (the credits popover's Add credits)
that must **not** look like standard list rows but **must** still join the menu's
roving focus so the keyboard can reach and activate them. Wrap the caller's own
`<Button>`/`<Link>` in **`DropdownMenuActionItem`** (asChild): it becomes a real
Radix menu item — `role="menuitem"`, roving tabindex, Enter/Space → click — while
keeping its own button look (the primitive adds no list-row chrome). Never leave
a plain `<button>` inside a menu: Radix's roving focus won't reach it, so it is
keyboard-unreachable.

## When to use which primitive

| Use | For |
| --- | --- |
| **`DropdownMenu`** (this surface) | Every transient menu: value pickers, action menus, workspace/account switchers, and rich floating panels like the credits popover. Click-triggered. |
| **`Popover`** (`popover.tsx`, light surface) | Non-menu floating content that is genuinely a *light* card (e.g. an info card). **Do not use it for menus**, and do not force-paint it to look like glass. |
| **`Select`** (`select.tsx`, bordered light) | Native-style form `<select>` replacement inside forms only. **Not a menu.** Bordered and light; do not use it for app menus. |
