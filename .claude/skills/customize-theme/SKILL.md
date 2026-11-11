---
name: customize-theme
description: Restyle this app through its shared CSS design tokens and the /admin/theme editor. Use for colour, typography, radius, spacing, elevation, or motion changes that should affect the product consistently.
---

# Customize the theme

Read `docs/spec/08-design-system.md` and `src/app/globals.css` first. The CSS file is the source of truth for the rendered theme.

## Use the operator console's theme page

1. Start the app with the repository's normal development command and open `/admin/theme`. The route must be enabled by the environment gate used for the operator console.
2. Enter edit mode, adjust tokens, and inspect the running app in light and dark mode.
3. Copy the generated `:root`, `.dark`, and `@theme inline` blocks.
4. Paste the changed values back into the matching blocks in `src/app/globals.css`. Edit mode previews changes but does not save them.
5. Keep dark-theme values intentional. Pasting light values must not erase shipped dark overrides unless you chose replacements.
6. Update `docs/spec/08-design-system.md` to the new values: the radius sentence in section 4 (the four sizes and whether `--radius-button` ships as a pill or a pixel value) and the contrast claims in the Status section.

## Keep token ownership clear

Change shared tokens rather than restyling individual pages or components. Do not create a second stylesheet, theme registry, database-backed theme, runtime generator, or one-off Tailwind colour aliases. Do not edit component classes to force a global theme choice. Preserve semantic roles such as background, foreground, primary, accent, destructive, border, input, and ring.

Keep focus rings visible, text contrast readable, and reduced-motion behavior intact. Do not change `@theme inline` mappings unless a token is deliberately added, removed, or renamed across all consumers.

## Verify

Run:

```bash
pnpm validate:config
pnpm verify
```

Then inspect `/admin/theme` and affected product routes. Check light mode, dark mode, keyboard focus, reduced motion, hover, and touch behavior. Theme token changes require visual regression coverage because they affect the entire application. If `pnpm validate:config` reports brand, preset, integration, tier, or environment errors, fix the named configuration source rather than hiding the check; it does not directly validate CSS token values.
