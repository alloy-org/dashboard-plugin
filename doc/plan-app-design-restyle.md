# Plan: restyle the dashboard to match the Amplenote app

> This is the history of the restyle. For how to build UI today, see [`design-system.md`](design-system.md).

The dashboard should look like part of the app it lives in: the same colors, type, icons, buttons, and card shapes the
app uses on its own pages (the Task Stats page is the closest reference). This pass changes style only.

## Ground rules

- Style only. Widget names, copy, settings, and behavior stay as they are, except that the background image goes away.
- No emoji in the design. Emoji used as icons or decoration become Material icons; wording stays the same. The mood
  rating faces are the one exception, because the app's own mood meter uses the same emoji. Emoji inside user content
  (task text, habit names) is content and stays.
- Colors come only from the host app's custom properties, so whichever theme the user picked (Classic, Plum,
  Sunburst, ...) and light/dark mode apply. The fixed priority, category, and calendar-dot colors are unchanged.
- The grid keeps its current placement, including the holes the default order leaves.

## Shared building blocks

- Icons: Google's Material icons (the set the host app's icon font uses) from the `react-icons` package —
  `import { MdRefresh } from "react-icons/md";` then `<MdRefresh />`. `IconContext` in `dashboard-load.jsx` sets the
  defaults (`lib/dashboard/icon-defaults.js`: 18px, `material-icon` class, `aria-hidden`); pass `size` or `className`
  to override. Widget and layout profile icons live in `lib/dashboard/widget-icons.jsx`, not the registry, because host
  code reads the registry and may not import packages. Chart tooltips render React content through
  `useStatsChartTooltip` in `charts/stats-chart-tooltip.jsx`.
- `lib/dashboard/styles/controls.scss` — `@use 'controls' as *;` then `@include icon-button`, `text-button`,
  `outlined-button`, `raised-button`, `overline-label`, `empty-state`.
- Colors: only the tokens in `styles/theme-tokens.scss`. Host colors carry the host app's own names, so
  `$color-text-low-contrast` is ample-web's `--color-text-low-contrast` in the user's theme and mode:

  | Role | Tokens |
  |---|---|
  | Surfaces | `$color-background-primary` (cards), `-secondary` (page), `-tertiary`, `-element-low-contrast`, `-element-medium-contrast`, `-popup` (tooltips, menus), `-dialog` (dialog title bar), `-scrim` |
  | Text | `$color-text-high-contrast`, `-medium-contrast`, `-low-contrast`, `-lower-contrast`, `$color-text-link`, `$color-text-nav-high-contrast` / `-low-contrast` (on the dialog title bar) |
  | Action | `$color-background-action-high-contrast` filled with ink `$color-text-button`; `-medium-contrast`, `-low-contrast` fills |
  | Status | `$color-text-status`, `$color-text-error-high-contrast` (danger), `$color-text-error-low-contrast` (warning), `$color-background-error-medium-contrast` |
  | Lines | `$color-border-primary` |
  | Data | `$victory-value-color-0…4` (+ `-text`), and fixed series colors (`--dashboard-color-category-*`, project windows, priorities, intents) for charts only |

  Values and fallbacks (the host's Classic light/dark) live in `theme-light.scss` / `theme-dark.scss`. Shadows:
  `$shadow-elevation-2` (raised buttons), `-3` (tooltips, menus), `-24` (dialogs). Corners: `$radius-sm` (4px),
  `$radius-lg` (8px). `test/design-tokens.test.js` fails on removed token names, direct `var(--color-*)` reads, and raw
  colors outside the theme files.

## Dialogs and popups (host MDC dialog)

- Surface: `$color-background-primary`, 4px corners, `$shadow-elevation-24`, `$color-background-scrim` behind.
- Title bar: `$color-background-dialog` fill (the host's dialog title color, dark in every theme) with
  `$color-text-nav-high-contrast` 20px/500 title text and a round close icon button in `$color-text-nav-low-contrast`
  on the right.
- Body: 24px padding, 14px text. Section titles use `overline-label`; field labels 12px/500 muted.
- Inputs and selects: 1px `$color-border-primary`, 4px corners, 36px tall, focus border
  `$color-background-action-high-contrast`.
- Actions: right-aligned footer, text button for Cancel, raised button for the primary action.
- Tabs inside dialogs: underline tabs like the dashboard header (2px bottom rule on the active tab).

## 1. Foundation: tokens and live theme refresh

- `styles/theme-tokens.scss`: card corners 8px, small and medium corners 4px.
- `styles/theme-light.scss` / `theme-dark.scss`: map the extra host variables the new styles use
  (`--color-text-lower-contrast`, `--color-background-element-low-contrast`, `--color-background-action-low-contrast`).
- The header bar is no longer filled with the action color; header text uses medium-contrast text.
- `host-theme.js`: also refresh when the pointer comes back over the dashboard (throttled), in addition to focus and
  visibility, so a theme change made in the app shows up as soon as the user returns to the dashboard.

## 2. Icons

- Google Material icons from `react-icons/md`, imported per icon; esbuild bundles only the icons that are imported.
- Widget header icons come from `WIDGET_ICON_BY_ID` in `widget-icons.jsx`; layout profile icons from
  `LAYOUT_PROFILE_ICON_BY_ID`. The registry's emoji `icon` field is gone.

## 3. Widget chrome

- Card: host primary background, 1px primary border, 8px corners, no translucency.
- Header: 18px icon in low-contrast text, 12px uppercase title in medium-contrast text, subtitle after a "·", actions
  on the right. Icon-only actions keep their wording as tooltip and aria-label. The gear becomes `settings`.
- Focus mode, drag, and wobble keep working. The focus ring uses the action color.

## 4. Dashboard header

- The toolbar becomes a header like the app's Task Stats header: task domains as underline tabs (same behavior),
  refresh, settings, layout, and the update indicator as icon buttons with tooltips.

## 5. Widget contents in the default view

- Shared partials for buttons (text, outlined, raised), list rows, empty states, and small labels.
- Every widget in the default layout, the Agent Pro upsell, and the quarterly plan entry screens move onto them.
- Inspiration Quotes keeps its photos; Quick Actions loses "Swap Background".

## 6. Background removal

- Remove the Background Image URL and Background Image Mode settings, their options, the settings popup fields, the
  inline background and fade overlay, `hooks/use-background-swap.js`, and the background parts of
  `dashboard-init-service.js`. `util/background-splash-images.js` stays for the quote photos.

## 7. Charts (second pass)

- Victory Value, Peak Hours, and Energy Delta Per Habit follow the app's Task Stats graph: 1px grid lines in the
  border color at 40% opacity with 12–14px low-contrast labels, uppercase low-contrast x-axis labels, the host's
  `--victory-value-color-0…4` scale, no glow or drop shadows.
- Hover: the hovered column gets the Task Stats treatment (a highlight line behind the bar in
  `--color-background-element-medium-contrast`, the value in a small pill) and a tooltip in the Task Stats tooltip
  style (popup background, 4px corners, elevation 3, title row then stat rows with icons).

## 8. Settings menus and Plan Builder (second pass)

- Dashboard Settings, Layout, widget configure popups, and the memory measurement popup take the dialog style above.
- The Plan Builder overlay takes the same dialog style; its steps, cards, chips, and buttons move onto the shared
  controls and tokens, and its emoji and symbol glyphs become Material icons.

## Verification

- `npm test`
- `npm run dev`, checked at desktop and phone width, light and dark, and a non-Classic theme.
- `npm run build`, noting the change in artifact size.
