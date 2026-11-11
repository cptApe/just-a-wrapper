# 09 — Modals: the one overlay family

Every overlay surface in the app that takes focus away from the page — dialogs, side panels, sheets, fullscreen takeovers — is **one component family**: `Modal` in `src/components/ui/modal/`. There is no second way to build an overlay. Two legacy files remain for five surfaces: `ui/dialog.tsx` for the sidebar task rename, the shared "Delete task?" confirm (`DeleteTaskDialog`) and the theme save dialog, and `ui/sheet.tsx` for the phone navigation drawers of the app shell and settings. Do not add consumers.

Every modal uses a sticky header and footer, with only its content scrolling. The header holds the centered title and close control; actions go in the footer. Reuse the same component family for dialogs, side canvases, floating sheets and fullscreen views.

**Overlay model:** one global overlay host at app-shell level, driven by the URL hash (*url = state*); overlays are self-sufficient and load their own data from hash params, so any overlay opens over any route. *Which* overlays exist and under which hash tokens is the shipped code. This doc is the component family that implements the host: `dialog` for blocking modals, `canvas` for the side canvas (its pop-to-full-screen state is `fullscreen`), `sheet` for side-panel/bottom-sheet.

The contract: a semantic `<header>/<footer>` around one scroll region, header grid `minmax(36px,1fr) auto minmax(36px,1fr)`, 36px close button.

---

## 1. The geometry contract

Every modal, regardless of presentation, is the same vertical sandwich:

```
┌────────────────────────────────────┐
│ ModalHeader   ← sticky chrome      │  [← back] · title centered · [controls] [✕]
├────────────────────────────────────┤
│ ModalContent  ← the ONLY scroll    │
│               region               │
├────────────────────────────────────┤
│ ModalFooter   ← sticky chrome      │  [left slot: progress/meta] · [actions, primary rightmost]
└────────────────────────────────────┘
```

- **Panel**: `--popover`, radius 24, **no shadow** — the `--overlay` backdrop (no blur) does all the separation. Canvas is the exception: no overlay, the page stays interactive.
- **Header** (h ≥ 64, px 20): a 3-column grid `minmax(36px,1fr) · minmax(0,auto) · minmax(36px,1fr)` — back pill left slot, title centered, close pill rightmost. The close pill is the **28-in-36** pattern (36px hit target, 28px visible fill) and is *always* in the same spot. **Nothing else ever lives in the header.** Icon-only *frame controls* (prev/next, expand toggle — things that operate the modal itself) may sit left of the ✕ via the `controls` slot; content *actions* (Connect, Save, Delete) never do.
- **Content** (px 32, pt ~16, pb 24): `min-h-0 flex-1 overflow-y-auto`. If you find yourself adding `overflow-y-auto` anywhere else inside a modal, the composition is wrong.
- **Footer** (px 20, pt 16, pb 20): actions right-aligned, **primary rightmost**, buttons same size. The `left` slot carries progress (multistep) or secondary meta — never a competing action cluster.
- **Scroll-edge indication**: header and footer are **chromeless at rest**. While content is scrolled behind one, it gains a 1px hairline (`alpha-8`, drawn as a box-shadow so nothing reflows; 150ms fade). At the top, the header hairline is gone; at the bottom, the footer hairline is gone; content that fits shows neither. Implemented with IntersectionObserver sentinels inside `ModalContent` — no scroll listeners.
- **Motion** (§6 Interaction and motion of 08-design): dialog/fullscreen 400ms `--ease-ios-sheet` fade + zoom 0.95→1; sheet/canvas slide from their edge, 500ms in / 300ms out. Reduced motion respects the global floor.
- Focus is trapped (Radix), ESC closes (when closable), scroll is locked (except canvas), focus returns to the trigger.

## 2. The four presentations

| Presentation | Geometry | Semantics |
|---|---|---|
| `dialog` (default) | Centered, content-sized height (max-h `min(85dvh, 800px)`), max-w by `size`: **sm 480 / default 560 / lg 960** | Blocks the page, full focus — forms, confirms, detail views. Content-sized: a confirm is short, and that's fine. |
| `canvas` | Right edge, full height, rounded-l-24, **no overlay, page interactive**, optional `resizable` drag handle (min 420px, ≥280px of page always visible). `floating` is the inset-card variant that pushes /app content aside at wide viewports; `width` locks a floating canvas to one fixed width (no drag handle, no shared stored width) | Content beside the page, page stays usable. The Manus computer-panel precedent. A fixed narrow `width` is for a pick-one list beside the page (the preview's list frame). |
| `sheet` | Floating side panel, 12px edge gap all around, radius 24, `side` left/right, w by `size`: **sm 320 / default 480 / lg 640** | Secondary flows that keep page context visible without page interaction. |
| `fullscreen` | Viewport minus 24px gap (32px ≥ lg), radius 24 | The canvas's popped state and the biggest frame allowed — rich media, immersive detail. The page must stay visible at the edges: a modal is a layer, never a navigation. |

**Phones (below `sm`):** every `dialog` is a bottom sheet: full width, top corners only, pinned to the bottom with the status bar and a 16px strip of page above it, sliding up instead of zooming. `fullscreen` becomes the tallest sheet of the same shape. The panel pads the home indicator. The header is 56px with 44px pills hugging the 16px page gutter, content uses the 16px gutter, and a footer without a `left` slot gives its actions equal widths across the row, primary still rightmost. `mobile="dialog"` keeps the centered card for a dialog that must not be a sheet. A detail modal whose tabs change its height passes `className="max-sm:h-full"` so the sheet's top edge stays put. A modal whose content carries its own large title uses `<ModalTitle reveal="scroll">`: the header title stays hidden at the top and fades in once that title scrolls behind the header.

If none fits, the answer is one of these four done better — not a fifth presentation and not a hand-rolled overlay.


## 3. API

```tsx
import { Modal, ModalHeader, ModalTitle, ModalDescription, ModalContent,
         ModalFooter, ModalClose, ModalIconButton } from '@/components/ui/modal';

<Modal open={open} onOpenChange={setOpen}    // or `trigger={<Button…/>}` for uncontrolled
       presentation="dialog" size="sm" closable>
  <ModalHeader>                              // omit entirely for the no-header variant
    <ModalTitle>Rename workspace</ModalTitle>
  </ModalHeader>
  <ModalContent>…fields…</ModalContent>
  <ModalFooter>
    <ModalClose asChild><Button variant="ghost">Cancel</Button></ModalClose>
    <Button onClick={save}>Save</Button>
  </ModalFooter>
</Modal>
```

- A modal that edits a value wraps its content and footer in `Form` from `@/components/ui/form`: `<Form className="flex min-h-0 flex-1 flex-col">` after the Header keeps the layout chain intact, and Cmd+Enter saves (see [patterns](03-patterns.md#forms-the-one-way-to-build-one) and `name-dialog.tsx`).
- Every modal needs a `ModalTitle` for its accessible name — `className="sr-only"` when the content visually carries it (integration detail, nav sheets).
- `ModalHeader align="start"` swaps the centered grid for a leading title+meta stack (canvas previews, fullscreen with identity row). The close pill stays rightmost either way.

## 4. Variants are composition, not props

- **Non-closable** (welcome and forced flows): `closable={false}`. The ✕, ESC, and outside-click all disappear; the flow's own footer action is the only exit. Use sparingly — a user who can't leave had better be mid-something-important.
- **No header** (dialog-02 — content with its own hero): omit `ModalHeader`; the close pill floats top-right *over* the content (the panel renders it automatically while `closable`).
- **Multistep** (dialog-03/06): `<ModalHeader onBack={step > 1 ? back : undefined}>` puts the ← pill in the left slot; `<ModalFooter left={…}>` carries progress or meta; the primary action stays rightmost and becomes Finish on the last step.
- **Preview frame**: `PreviewSurface` (`ui/preview-surface.tsx`) is a thin wrapper over Modal for showing **one thing**: a single item (file, chart, note, live browser) or a single narrow list to pick an item from. It is not a file browser — no sibling rail, no prev/next, no type/size/date line under the title. Its header carries exactly two frame controls: Close, and (for `frame="preview"` only, never for `frame="list"`) one expand/collapse toggle between the side canvas and the fullscreen frame, remembered per kind in localStorage. `frame="preview"` is the resizable floating canvas at the shared stored width; `frame="list"` is the same floating canvas locked to the family's 320px `sm` width — page interactive, no scrim, no drag handle, no expand — and it never reads or writes the preview's stored width. Download is a frame-bar button in the header, left of expand/collapse and Close, via the `headerActions` slot. Actions that need a label (save, take control) go in the optional `actions` slot, a compact toolbar at the top of the content; a preview whose only action is Download has no content toolbar. Every control the frame owns (Close, expand/collapse, toolbar buttons, menu rows, list rows, an error state's Try again) has a **44px hit target** — the pill's visible fill stays the family's 28px, so this is 28-in-44 rather than the header's default 28-in-36, and the header keeps its 64px height. Opening another item while one is open replaces the current preview (one history entry, so Close and Back land on the page underneath); changing app pages closes it. Use it for previews; use Modal directly otherwise. Expansion preserves the preview child instance. The fullscreen frame owns a scrim, scroll lock and focus trap while the underlying Radix content stays non-modal to prevent remounts. Canvas width is persisted only after user resizing.

## 5. DON'Ts

- **No actions in the header.** Connect next to the ✕ is the canonical violation. Actions go to the footer; the header right slot is for the close pill and frame controls only. The one exception is a preview's Download button (`PreviewSurface` `headerActions`), placed beside the frame controls.
- **No nested scroll regions.** One `ModalContent` scroll container per modal. A `<pre>` or code block may scroll horizontally; nothing else scrolls vertically inside the content.
- **No custom one-off overlays.** No hand-rolled `fixed inset-0` divs, no raw Radix Dialog outside `ui/modal/`. If a surface needs something the family lacks, extend the family.
- **No persistent hairlines/borders on header or footer.** The hairline is scroll-state, not decoration.
- **No shadows on panels, no backdrop blur on overlays, no accent-colored chrome.** Modals are neutral surfaces; glass (`--glass-*`) belongs to floating menus, not modals.
- **No size invention.** Three dialog widths, three sheet widths. A "590px just this once" is a review rejection.

## 6. Implementation notes

- `src/components/ui/modal/modal-panel-class-name.ts` — panel geometry per presentation, including the phone sheet.
- `src/components/ui/modal/modal.tsx` — root, presentations, overlay, floating close, canvas resize and the fixed `width` bypass, `ModalIconButton` (the 28-in-36 pill; `className` may widen the hit box, as the preview frame does).
- `src/components/ui/modal/modal-sections.tsx` — Header/Title/Description/Content/Footer/Progress, scroll-edge sentinels.
- Header/description presence is registered via layout effects, so the floating ✕ and Radix's `aria-describedby` warning resolve without prop duplication.
- The dialog presentation centers through an inert flex wrapper (`pointer-events-none`, panel `pointer-events-auto`) so content-sized height + max-height behave without transform-centering fighting the zoom animation.
