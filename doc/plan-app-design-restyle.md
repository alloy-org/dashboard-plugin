# Plan: restyle the dashboard to match the Amplenote app

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

- `lib/dashboard/material-icon.jsx` — `<MaterialIcon name="refresh" size={ 18 } />`, drawn in `currentColor`. Path data
  lives in `lib/constants/material-icon-paths.js`; add icons by regenerating that file rather than hand-editing it.
- `lib/dashboard/styles/controls.scss` — `@use 'controls' as *;` then `@include icon-button`, `text-button`,
  `outlined-button`, `raised-button`, `overline-label`, `empty-state`.
- Tokens in `styles/theme-tokens.scss`: `$color-bg-card`, `$color-bg-page`, `$color-bg-element`, `$color-action-low`,
  `$color-border`, `$color-text`, `$color-text-secondary`, `$color-text-muted`, `$color-text-lower`, `$color-link`,
  `$color-accent`, `$color-background-accent` + `$color-text-on-accent`, `$radius-sm` (4px), `$radius-lg` (8px).

## Dialogs and popups (host MDC dialog)

- Surface: `$color-bg-card`, 4px corners, MDC elevation 24 shadow
  (`0 11px 15px -7px rgba(0,0,0,.2), 0 24px 38px 3px rgba(0,0,0,.14), 0 9px 46px 8px rgba(0,0,0,.12)`), scrim behind.
- Title bar: `var(--color-background-dialog)` fill (the host's dialog title color, dark in every theme) with
  `var(--color-text-nav-high-contrast)` 20px/500 title text and a round close icon button in
  `var(--color-text-nav-low-contrast)` on the right. Fallbacks: `#2C3B47`, `#EDF1F5`, `#B4BFCC`.
- Body: 24px padding, 14px text. Section titles use `overline-label`; field labels 12px/500 muted.
- Inputs and selects: 1px `$color-border`, 4px corners, 36px tall, focus border `$color-accent`.
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

- The embed runs from an opaque-origin document and can't load Google Fonts, so Material icons ship as inline SVG
  paths through a small `MaterialIcon` component.
- Widget registry entries get an `iconName` for the card header. The emoji `icon` stays for popups not yet restyled.

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
