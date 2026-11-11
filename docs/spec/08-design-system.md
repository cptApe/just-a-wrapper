# 08: Design system

This document describes the interface that ships today. The source of truth for token values is [`src/app/globals.css`](../../src/app/globals.css). Shared primitives live in [`src/components/ui`](../../src/components/ui), and overlay behavior is specified in [`09-modals.md`](09-modals.md).

The shipped design and shared application sources define the standing system.

## 1. Configuration model

The theme uses standard CSS custom properties. Change the declarations in the `:root` block of `globals.css` for the light theme and the `.dark` block for dark-theme overrides. Tailwind's `@theme inline` block maps those properties to utilities such as `bg-background`, `text-body`, `rounded-lg`, and `shadow-popover`.

There is no theme code generator and no database-backed theme state. `/admin/theme` reads the editable variable names directly from `globals.css`; its edit mode applies edits to the document's inline style for a live preview over the running app, and copies paste-ready `:root`, `.dark`, and `@theme inline` overrides. The dark block preserves the shipped dark-theme values unless the operator edits it after pasting. The page is protected by the same environment gate as every other `(admin)` route. It does not persist changes.

Brand identity strings (name, domain, support address) come from configuration and are read through `src/lib/brand` ([decision 0048](../decisions/0048-brand-and-contact-come-from-configuration.md)). Colours live only in `globals.css`.

## 2. Color

The color system has three layers. A neutral spine, `--neutral-0` through `--neutral-100`, that no component reads directly. Semantic roles with shadcn names that every component uses. And a small set of media tokens that stay fixed in both themes.

### Neutral spine

Light mode runs from a warm page background to near-black text. Dark mode inverts the same names so semantic mappings do not change. Components never use a neutral name; they use a role.

### Backgrounds

Four background roles. In light mode the page and sidebar are a warm bed, and cards and dialogs are white so they lift off it. In dark mode the four climb in ascending order, each one notch further from the page.

| Token | Role | Light |
|---|---|---|
| `--background` | Page body | `#f9f8f7` |
| `--sidebar` | Navigation sidebar, one notch deeper | `#f5f3f2` |
| `--card` | The chat input and raised blocks | `#ffffff` |
| `--popover` | Dialogs, sheets, and floating panels | `#ffffff` |

The chat composer paints `--card`, so the Card control in `/admin/theme` restyles the input without touching the page. Every surface in the table is opaque.

The sidebar carries its own companions: `--sidebar-foreground`, `--sidebar-accent` for hover and selected rows, and `--sidebar-border`. Resting surfaces do not use shadows. Floating panels use `--shadow-popover`; dark glass menus use the `--glass-*` family and `--shadow-glass`.

### Fills and lines

The `--alpha-3` through `--alpha-24` ramp supplies hover fills, pressed fills, borders, and focus rings. It is black-based in light mode and white-based in dark mode. `--border` and `--input` map to the 8 percent step; `--ring` maps to the 24 percent step. `--muted`, `--secondary`, and `--accent` all map to the 6 percent step, which is the shadcn meaning of accent: the quiet fill behind hovered, focused, and selected rows.

### Text

Three steps carry all hierarchy: `--foreground`, `--muted-foreground`, and `--foreground-tertiary` for placeholders and inactive tabs.

### Primary

`--primary` is the brand color and the fill of the primary button. It is its own value so an operator can change it without touching text. It ships as near-black in light mode and near-white in dark mode, paired with `--primary-foreground`. Emphasis fills such as the calendar's today pill and the user's message bubble use the same role.

### Attention

`--attention` is the one colored accent. It carries the unread dot on sidebar task rows and the hover and keyboard-focus color of links inside rendered markdown, text and underline together. At rest a link stays underlined foreground text, so touch users see it without hovering. Primary buttons keep `--primary`, and hovered or selected rows keep the neutral `--accent` fill; neither follows this token. It ships as a readable blue in both themes, which is the initial design choice pending review: at least 4.5:1 against the page, sidebar, card, and dialog surfaces in each theme. The theme editor lists it as Attention beside Primary.

### Status

`--success`, `--warning`, `--destructive`, and `--info` each come in three forms. The base is for text, icons, and outlines. The `-soft` form is a translucent tint for chips and banners that works over any surface. The `-strong` form is a saturated fill or glyph that must read at a glance. White text holds AA only on `--destructive-strong`; `--success-strong` and `--warning-strong` are glyph fills and carry no text. `--destructive-foreground` is white in light mode and near-black in dark mode, where white would fail AA on the lifted red.

The palette uses vivid 500-level hues in light mode and lifted 400-level hues in dark mode. Text-bearing base colors deepen where needed to keep 4.5:1 contrast on tinted fills. Soft fills use brighter source hues so yellow and green badges retain their color. Strong glyphs and file-type icons keep at least 3:1 against page, sidebar, card, and popover surfaces, including muted file tiles. File colors follow the saturated file-type palette; in dark mode red, blue and violet use the lifted status hues.

Status messages have three surfaces. The result of an action is a `sonner` toast. A failed page or panel load is `ErrorState`. A problem that stays until it is fixed is `WarningBar` in `src/components/ui/warning-bar.tsx`: one message line and one action area on `--warning-soft`.

### File types

Every surface that shows a file draws it the same way: chat (composer, sent messages, tool results, inline file links), the Library, the composer's Library picker, the task-files overlay and the public share page. `FileKindIcon` and `fileKindGlyph` in `src/features/files/components/file-kind-icon.tsx` hold the one table. Each surface sets only the size; only the glyph is tinted, and tiles, rows and selection keep their neutral fills.

| Kind | Glyph | Tint |
| --- | --- | --- |
| Image | `IconImage01` | `--file-image` |
| Video | `IconPlayCircle` | `--file-image` |
| Audio | `IconMusicNote01` | `--file-audio` |
| PDF | `IconFile04` | `--file-pdf` |
| Document | `IconFile02` | `--file-document` |
| Slides | `IconPresentationChart01` | `--file-slides` |
| Spreadsheet | `IconTable` | `--file-sheet` |
| Code | `IconFileCode01` | `--file-code` |
| HTML | `IconGlobe01` | `--file-code` |
| Archive | `IconPackage` | muted |
| Other | `IconFile02` | muted |

`--file-*` is the only file colour family, with a lifted value for dark mode.

Info badges and toast icons use `--info`. Checked switches use `--switch-checked` with `--switch-foreground` for the thumb in both normal and glass contexts. The checked fill is its own green, independent of primary buttons and neutral text. Feature icon tiles that use neutral tokens stay neutral.

### Media

`--overlay` is the dialog backdrop. `--scrim` sits behind pills and veils over images. `--media-bed` is the letterbox behind video. `--on-media` is text over any of those. `--paper` is a document canvas for PDF, HTML previews, and logo tiles. These do not change with the theme because they sit over content, not over the page.

The home page's setup commands use the same fixed approach: `--code-surface` with `--code-plain`, `--code-comment`, `--code-command`, and `--code-string`, so the block reads as a dark terminal in both themes.

### Charts

`--chart-1` through `--chart-6` order the neutral spine and the status palette for categorical separation.

## 3. Typography rules

Inter is the functional typeface through `--font-sans`. Code and machine-readable values use `--font-mono`. The app has **four text styles**. This section is the source for numeric values and slot assignments; the utilities themselves are defined in `src/app/globals.css`.

### Four app styles

| Utility | Size and line height | Weight | Use |
|---|---:|---:|---|
| `text-title-page` | 32 / 38px | 450 | Page title |
| `text-title-section` | 18 / 24px | 600 | Section and dialog titles |
| `text-body` | 15 / 22px | inherited | Body: regular 400 for reading; medium 500 for form, tab and button labels |
| `text-meta` | 13 / 18px | inherited | Help: regular 400 for detail; medium 500 for chips, counts, table headers and timestamps |

Body and Help inherit their CSS weight, so use `font-normal` (400) or `font-medium` (500) explicitly for their slot. Page titles keep 450; do not override them to regular. Section and dialog titles use 600. The everyday choice is regular or medium, not another size.

### Docs and shared pages

| Utility | Size and line height | Weight | Use |
|---|---:|---:|---|
| `text-body-lg` | 16 / 24px | inherited | Reading text, regular 400 for docs and shared pages; medium 500 for navigation |

Reading text is not a fifth app style. App explanations use Body. Cap prose at about **65 characters** (`max-w-[65ch]`); keep paragraphs wrapping and use each style's paired line height.

### The one exception: row titles

| Utility | Size and line height | Weight | Use |
|---|---:|---:|---|
| `text-title-card` | 14 / 20px | 500 | Existing card and row titles only |

This is **the one exception**. It is not another general app style. Do not reuse it for new labels, notices or empty states.

### No caption style

Use **Help text, medium**: 13 / 18 px, weight 500. There is no Caption style.

### Choose by slot

Choose **size, then weight, then color**: first pick the text's job from the four styles, then its permitted weight, then its semantic color. Do not keep enlarging important text. Keep weight steady on hover and selection. The regular/medium everyday budget plus the 450 page and 600 section weights are product choices, not values prescribed by the sources. Page titles retain their existing tracking; sizes, line heights and tracking stay paired through the role utilities. Use tabular figures for changing numbers.

| Slot | Utility | Size / line height (px) | Weight | Color token | Example |
|---|---|---|---|---|---|
| Page title | `text-title-page` | 32 / 38 | 450 | foreground | Tools |
| Section title | `text-title-section` | 18 / 24 | 600 | foreground | Connection settings |
| Compact section title inside a dialog | `text-title-section` | 18 / 24 | 600 | foreground | Actions; Read-only |
| Card or row title | `text-title-card` | 14 / 20 | 500 | foreground | Your Gmail account |
| Row meta | `text-meta` | 13 / 18 | 400 | muted-foreground | In use |
| Description or help line | `text-meta` | 13 / 18 | 400 | muted-foreground | Choose when your agent can use these tools. |
| Primary prose | `text-body` | 15 / 22 | 400 | foreground | What you can do with Gmail |
| Longer reading content | `text-body-lg` | 16 / 24 | 400 | foreground | Shared document paragraphs |
| Navigation item | `text-body-lg` | 16 / 24 | 500 | foreground selected; foreground/80 at rest | Scheduled |
| Form label | `text-body` | 15 / 22 | 500 | foreground | Feedback about this app |
| Input text | `text-body` | 15 / 22 | 400 | foreground; placeholder foreground-tertiary | Textarea or Input value |
| Button label, lg / default | `text-body` | 15 / 22 | 500 | primary-foreground on primary; foreground on secondary/ghost/link; destructive on destructive | Connect |
| Button label, sm | `text-body` | 15 / 22 | 500 | Same variant colors as above | Send |
| Button label, xs | `text-body` | 15 / 22 | 500 | Same variant colors as above | Copy |
| Caption or chip | `text-meta` | 13 / 18 | 500 | muted-foreground; semantic status token for status chips | 12 actions |
| Empty state title | `text-body` | 15 / 22 | 500 | foreground | No account connected yet |
| Empty state line | `text-meta` | 13 / 18 | 400 | muted-foreground | Connect above to add one. |
| Dialog title / identity heading | `text-title-section` | 18 / 24 | 600 | foreground | Gmail |
| Tab label | `text-body` | 15 / 22 | 500 | foreground selected; muted-foreground unselected | Overview |
| Table header | `text-meta` | 13 / 18 | 500 | muted-foreground | Status |
| Notice title / line | `text-body` / `text-meta` | 15 / 22; 13 / 18 | 500 / 400 | foreground / muted-foreground | Couldn’t load actions / Close and try again. |

The table is the rule for app text. Some shared controls keep their own sizes: inputs use `text-body-lg` (16px) below `sm`, and some buttons and tabs use 14px, 13px or 12px. Use the existing control components rather than building replacement controls with other sizes.

### Public references

These are source principles adapted to our existing Inter scale, not a claim that any author prescribed this exact table.

| Source | Short excerpt | Rule taken |
|---|---|---|
| Matthew Butterick, [Point size](https://practicaltypography.com/point-size.html) | “15–25 pixels” | Keep primary reading text at least 15px; judge the actual font on screen. |
| Butterick, [Line spacing](https://practicaltypography.com/line-spacing.html) | “120–145%” | Pair size with line height; avoid cramped multi-line text. |
| Butterick, [Line length](https://practicaltypography.com/line-length.html) | “45–90 characters” | Limit prose width; 65ch is our chosen point within that range. |
| Butterick, [Headings](https://practicaltypography.com/headings.html) | “Fewer levels, subtler emphasis” | Keep few heading levels and use modest size differences. |
| Adam Wathan and Steve Schoger, [7 Practical Tips for Cheating at Design, section 1](https://medium.com/refactoring-ui/7-practical-tips-for-cheating-at-design-40c736799886) | “two font weights is usually enough for UI work” | Use a small weight/color vocabulary, not size alone, to show importance. Their [book contents](https://refactoringui.com/) also name “Establish a type scale”. |
| Dan Hollick, [How to make a font](https://www.makingsoftware.com/chapters/how-to-make-a-font), public portion | “hinting instructions for rendering at small sizes” | Inspect rendered Inter at real UI sizes; font metrics alone do not prove readability. |
| Hollick, [Rasterisation and anti-aliasing](https://www.makingsoftware.com/chapters/rasterisation-and-anti-aliasing), public portion | “screens are still made up of discrete pixels” | Check actual rendered text rather than assuming vector outlines guarantee crispness. |
| Apple, [Human Interface Guidelines: Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | “Adjust font weight, size, and color” | Reuse text styles and preserve hierarchy when text grows; avoid thin small text. |
| Google, [Material 3 Typography](https://m3.material.io/styles/typography/overview) | “display, headline, title, body, and label” | Name styles by their purpose. Keep our four app roles, rather than importing Material's sizes. |
| Rasmus Andersson, [Inter](https://rsms.me/inter/) | “a tall x-height to aid in legibility” | Keep Inter for interface copy; use its tabular figures for changing counters. |
| Benji Taylor, [Family Values](https://benji.org/family-values) | “Every tray is equipped with a title” | Give each dialog a clear title describing its contents. This is interaction guidance, not a published type scale. |

## 4. Geometry and layout

The radius scale is `6px`, `10px`, `16px`, and `24px`, exposed as `--radius-sm` through `--radius-xl`. Small is for chips, keyboard hints, and badges. Medium is for rows, menu items, and inputs. Large is for cards, popovers, and the composer. Extra large is for dialogs, sheets, and menus. The operator sets `--radius-base`, which is the medium size, and the other three keep their ratio to it. Buttons, pill tabs, badges, tooltips, navigation items, and the search field use `--radius-button`. It ships as a pill; an operator can set it to any pixel value to square buttons off independently of the corner radius. Avatars, dots, and toggles stay fully round. Tailwind's own extra sizes are cleared, so only these sizes and full exist.

Standard pages use one `960px` maximum width through `--page-max-w`. The reading, content and wide names alias that same value. The expanded sidebar is `264px`; the collapsed sidebar is `60px`. The page gutter is 16px below `sm`, 24px from `sm` and 40px from `md` (`PAGE_COLUMN` in `src/components/layouts/page-shell.tsx`).

The only stacking levels are sticky `30`, dropdown `40`, dialog `50`, and toast `60`. Components use the matching utilities rather than literal z-index values.

## 5. Components

Shared primitives come from `src/components/ui`. Feature code composes them instead of restyling raw controls.

- Buttons are pill-shaped. The default height is `40px`; large is `44px`; compact variants are also shipped. Primary, secondary, ghost, destructive, and link variants are shipped.
- Inputs are `40px` high (`36px` on phones) with the medium radius, a quiet alpha fill, 16px text on small viewports so iOS does not zoom on focus, and a visible focus ring. Labels remain visible above form fields.
- List rows use the medium radius, an alpha hover fill, a content stack, and optional leading and trailing slots. A row group removes list styling without changing layout.
- Menus use the shared dark-glass grammar documented in [`src/components/ui/menu-README.md`](../../src/components/ui/menu-README.md).
- Dialogs, sheets, and canvases follow the single overlay family in `09-modals.md`.
- Toasts use the shared toast primitive and the strong status colors for their glyphs.

Icons always come from `@/components/icons`. Line icons are the default; solid icons are reserved for intentionally filled glyphs.

## 6. Interaction and motion

Focus uses the `--ring` token and must remain visible against the current background. Inputs, buttons, links, menu items, options, and tabs expose keyboard focus. Icon-only controls require accessible names. Touch targets should reach 44px when the surrounding row does not provide that target.

Phones (below `md`) get one top bar for standard pages, `MobileTopBar` in `src/components/layouts/mobile-top-bar.tsx`: the navigation button, the current page's name centred (the same label the sidebar or settings rail shows), and an optional action. `PageHeader` and `SettingsPageHeader` keep their title only for assistive technology below `md`, so the name appears once. Tabs, segmented controls, filter pills, toolbar icon toggles, search fields, text inputs, select and combobox triggers and their list items, and `sm`/`xs` buttons are 36px tall on phones, matching their desktop proportions; labels stay at the Body slot. Filter pill rows stay on one line below `md` and scroll sideways with `scroll-fade-x`. Menus, popovers, select lists and tooltips keep a 12px gap from the screen edge (`FLOATING_EDGE_GAP` in `src/components/ui/lib/floating.ts`). Page gutters are 16px on phones, 24px from `sm` and 40px from `md`.

Motion uses the declared easing and duration tokens. Fast is `150ms`, medium is `200ms`, slow is `300ms`, and sheet motion is `500ms`. Transition only the properties that change. Frequent product actions stay direct. The global reduced-motion rule collapses animation and transition durations when the user requests reduced motion.

Hover is an enhancement. Core behavior must work with touch and keyboard input. Press feedback may scale buttons, but opening overlays must not shift their trigger geometry.

## 7. Content

Use sentence case. Titles, labels, buttons, and chips do not end with a full stop. Descriptions and body copy use complete sentences. Button labels start with a verb and name the result. Errors state what happened and what the user can do next.

Product vocabulary stays user-facing: “action” instead of “tool call”, “connection” instead of “MCP server”, and “integration” instead of “toolkit”. Technical terms remain appropriate in operator and developer surfaces.

## 8. Verification

Use `/admin/theme` to inspect the token reference and its edit mode to try token changes against real components. A theme change is complete only after both themes, keyboard focus, reduced motion, and affected product routes have been checked. Changes to token values require visual regression coverage because they affect the whole application.

## 9. Coherence rules

The app is one product. A screen that invents its own controls is a defect, however good it looks on its own. These rules are the checklist for every UI change; the lander rejects a change that breaks one.

1. **One component per job.** Text field: `Input` / `Textarea`. Choice from a list: `Select`. Menu on a button: `DropdownMenu`. Filter pills: `PillTabs`. Segmented tabs: `Segmented`. Item lists: `ListRow` inside a padded container. Dialogs: `Modal` with `ModalHeader`, `ModalContent`, `ModalFooter`. Loading: `Spinner`. Never restyle these per feature and never rebuild them inline.
2. **Inputs look like inputs.** The `alpha-6` surface, rounded, no border, ring on focus. No white cards with borders standing in for a field, no dashed outlines, no ring inside a ring.
3. **Lists are padded containers with rounded rows.** The container is a soft surface with inner padding; each row rounds on hover; no row dividers and no full-width highlight. Library and Tools are the reference.
4. **Colors come from tokens.** No hex or hsl literals in components. Status, accent and file colors use the saturated tokens in `globals.css`. Selection and hover are the neutral alphas, never a brand blue.
5. **Sizes come from the scale.** Buttons `sm` in headers and toolbars, `default` in dialog footers. Section titles and labels follow the slot table in section 3. Icon tiles are `size-7` in rows, `size-11` in dialog headers.
6. **Copy is a sentence.** Capitalized first word, no "Repeat" prefixes, no disclaimers under fields. If a field needs explaining, the field is wrong.
7. **Copying a reference means its layout and logic, in our language.** Take the structure, the order, the sizes. Render it with the components above.

Before submitting UI for review, open the closest existing screen next to yours. If a control looks different from its sibling there, fix yours.

