# Theming

The web UI has colour schemes (themes) and a colour mode (dark, light, or follow the device). Both are per-browser
preferences, stored in `localStorage`, so each device can look different.

## Where to change it

- **Settings > General > Appearance**: pick a **Colour Scheme** (cards show the dark and light version of each) and a
  **Colour Mode**. Like every settings page change, these apply when you press **Save**.
- **Top bar**: a sun / monitor / moon switch (a single button that cycles on phones) changes the mode straight away.

Schemes: iPlayarr (the original pink), Ocean, Forest, Sunset, Violet and Graphite.

## How it works

| File | Role |
| --- | --- |
| `frontend/src/lib/themes.js` | Theme definitions. Each theme is a brand colour per mode plus an optional surface tint; a factory builds the full dark and light token sets (surfaces, text, role colours, chart colours). |
| `frontend/src/lib/theme.js` | The engine: reads the stored choice, writes the active tokens onto `<html>` as CSS custom properties (`--page-background-color` ...), sets `data-theme`, `data-color-mode` and `color-scheme`, follows the system setting in "Match system", and caches the page background for `index.html` so a reload does not flash. |
| `frontend/src/assets/styles/variables.less` | The Less colour variables (`@page-background-color`, `@brand-color` ...) are `var(--...)` references, so every stylesheet follows the active theme without changes. |
| `frontend/src/lib/chartTheme.js` | Colours for the ApexCharts components (they cannot use CSS variables). |
| `frontend/src/lib/useAppearanceDraft.js` | Holds the Appearance edits until Save applies them. |

## Colour roles

Use a role, not a raw colour, so a new theme only has to define the roles.

- **brand** (`@brand-color`, text on it: `@on-brand-color`): identity and the one primary action per screen: active nav
  and tab, Save, selection, focus.
- **info** (`@info-color`, `@primary-color`): links, informational notes, pagination, progress.
- **positive** (`@positive-color`): connected, in the library, success, complete.
- **caution** (`@caution-color`): warnings. **Unsaved changes use amber** (`@changed-color`), so Save is the only brand-coloured thing asking for attention.
- **danger** (`@danger-color`): errors, failures, delete.
- **chart-1 .. chart-6** (`@chart-1` ..): categorical colours; `chart-1` follows the brand.
- Fill colours (`@error-color`, `@warn-color`, `@success-color`, `@primary-color`, `@complete-color`) are for pill and
  button backgrounds; text on them is `@on-fill-color` (white) or the `@warn-text-color` / `@error-text-color` black.
  Text and icons on the page background use the role colours above, which are tuned per mode for contrast.

Fixed colours that must not change with the theme (white text over poster images, the log console) are written inline
where they are used.

## Adding a theme

Add a `define({ id, name, description, dark, light, tint })` entry to `THEMES` in `themes.js`: `dark` and `light` are the
brand colour in each mode as `#rrggbb`; `tint` is an optional `{ hue, sat }` that colours the greys. Check the result in
both modes on the Statistics, Queue and Settings pages.

## Layout scale

`variables.less` also holds a small layout scale for new work: spacing (`@space-1`..`@space-6`), corner radius
(`@radius-sm/md/lg`), type size (`@font-size-sm/md/lg`), motion (`@motion-fast/base`) and `@touch-target` (the 40px
minimum for a fingertip on phones). Older styles keep their literal numbers until they are next touched.

## Text over artwork

Text on poster or banner images (Discover hero, programme banner, media info banner, card labels, quality badges, channel
tile titles) is fixed white, never the theme's text colour, because the scrim behind it is dark in both colour modes.
