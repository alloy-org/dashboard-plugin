# Dashboard design system

The dashboard must look like part of the Amplenote app it is embedded in. Everything visual is built from four
shared layers — **tokens, icons, controls, and the widget frame** — and widget code adds only layout and the content
that makes the widget different. If you are about to write a color, a button style, a spinner, or an empty-state
layout yourself, stop: one of the layers below already has it.

Reference look: the host app's Task Stats page (cards, charts, tooltips) and its MDC dialogs.

## Rules

1. **Colors only from tokens** in `lib/dashboard/styles/theme-tokens.scss`. No hex, `rgb()`, or `var(--color-*)` in
   component stylesheets. Fixed data colors (chart series) live in the theme files, not in widgets.
2. **Icons only from `react-icons/md`** (Google Material icons, the set the host app uses). No emoji or Unicode glyphs
   as UI (✓ ✕ ← → ↻ ⚙ …). Emoji inside user content (task text, habit names) and the mood faces are content and stay.
3. **Controls only from `dashboard/controls`.** No raw `<button>`, `<select>`, `<input>`/`<textarea>` fields,
   `<a href="#">` buttons, spinners, or hand-made empty/loading/error markup in widgets, popups, or the Plan Builder.
4. **Widget stylesheets contain layout only**: positioning, gaps, grids, sizes, and content typography that is truly
   specific to the widget. They never restyle `dashboard-*` control classes.
5. **No glows, gradients on chrome, colored shadows, font weights above 500, or new corner radii.** Corners are
   `$radius-sm` (4px: buttons, fields, tiles) and `$radius-lg` (8px: cards). Shadows are `$shadow-elevation-*`.
6. **Words stay with icons.** An icon-only control always has a label (`IconButton label="…"`), which becomes its
   accessible name and tooltip.

`test/design-tokens.test.js` and `test/controls-usage.test.js` fail when rules 1 and 3 are broken.

## Tokens

Host colors carry the host app's own names (ample-web's `--color-*`), so `$color-text-low-contrast` is the app's
low-contrast text in whatever theme and light/dark mode the user picked. `@use 'theme-tokens' as *;` to use them.

| Role | Tokens |
|---|---|
| Surfaces | `$color-background-primary` (cards), `$color-background-secondary` (page), `$color-background-tertiary`, `$color-background-element-low-contrast` (hover/selected fills, tiles), `$color-background-element-medium-contrast`, `$color-background-popup` (tooltips, menus), `$color-background-dialog` (dialog title bar), `$color-background-scrim` |
| Text | `$color-text-high-contrast` (primary content), `$color-text-medium-contrast` (secondary), `$color-text-low-contrast` (labels, hints), `$color-text-lower-contrast` (faint icons, placeholders), `$color-text-link`, `$color-text-nav-high-contrast` / `$color-text-nav-low-contrast` (on the dialog title bar) |
| Action | `$color-background-action-high-contrast` fill with `$color-text-button` ink; `$color-background-action-medium-contrast`, `$color-background-action-low-contrast` (selected/hover tint) |
| Status | `$color-text-status` (success), `$color-text-error-high-contrast` (danger), `$color-text-error-low-contrast` (warning), `$color-background-error-medium-contrast` |
| Lines | `$color-border-primary` |
| Data | `$victory-value-color-0…4` and `-text` (the app's victory value scale), then fixed series colors (`--dashboard-color-category-*`, project windows, priorities, intents) for charts only |

Other tokens: spacing `$sp-xs/sm/md/lg/xl` (4/8/12/16/24px); type `$smaller-font-size` (13px), `$default-font-size`
(14px), `$large-font-size` (16px), headings from `$small-heading-font-size`; shadows `$shadow-elevation-2` (raised
buttons), `-3` (tooltips, menus), `-24` (dialogs). The `contrasting-color` mixin is only for text on a fixed data color.

## Icons

```jsx
import { MdRefresh } from "react-icons/md";
<MdRefresh />            // 18px, current text color, aria-hidden — defaults from IconContext (icon-defaults.js)
<MdRefresh size={ 16 } />
```

Find names at https://react-icons.github.io/react-icons/icons/md/ (prefer the filled `Md…` set). A widget's header
icon is set in `lib/dashboard/widget-icons.jsx` (`WIDGET_ICON_BY_ID`), never in the registry, because host code reads
the registry and may not import packages.

## Controls

```jsx
import { Badge, Button, EmptyState, ErrorState, IconButton, LoadingState, PlainButton, Select, Spinner, TextField,
  UnderlineTabs } from "dashboard/controls";
```

| Need | Use | Notes |
|---|---|---|
| A labeled action | `<Button variant="text" \| "outlined" \| "raised" Icon={ MdAdd } dense onClick>Add task</Button>` | One `raised` primary per view; `text` for secondary and row actions; `outlined` for alternatives beside a primary. `dense` (32px) in cards and rows. `href` renders a real link for navigation. `type="submit"` inside a form. `tone="danger"` for remove/delete. `TrailingIcon` for an icon after the label; `iconSize={ 16 }` for dense card actions. |
| An action inside a sentence | `<Button variant="link" onClick>AI settings</Button>` | Link text in the sentence's own size and casing. |
| An icon-only action | `<IconButton Icon={ MdRefresh } label="Reseed" onClick size="small" />` | `label` is required (accessible name and tooltip); `tooltip="…"` when the hover text should say more, `tooltip={ false }` when a tippy tooltip already explains it. `size="small"` in widget headers and rows, `"medium"` default, `"large"` in the dashboard header, `"dialog"` for a dialog's close. `pressed` for toggles; `tone="danger"`. `Icon` may also be an element. |
| A clickable card, row, or option | `<PlainButton className="my-option" onClick>…</PlainButton>` | No look of its own; style the card with your class. |
| Loading | `<LoadingState>Loading monthly task history…</LoadingState>` or `<Spinner size="small" />` inline | |
| Nothing to show | `<EmptyState Icon={ MdInbox } title="No tasks scheduled for today" action={ <Button>Open tasks</Button> }>One sentence.</EmptyState>` | Faint icon, short title, one sentence, optional action. `compact` for one inline line inside a list (e.g. under a day). |
| Failure | `<ErrorState onRetry={ reload } action={ <Button href={ url }>View note</Button> }>The note could not be loaded.</ErrorState>` | Announced as `role="alert"`; don't wrap it in another alert. `title={ null }` for no title. |
| A dropdown | `<Select label="Collaborator" options={ [ { label, value } ] } value onChange={ value => … } />` | `onChange` gets the value. `hideLabel` for compact toolbars, `dense` (32px) in toolbars and rows. |
| Text input | `<TextField label="Details" multiline value onChange={ text => … } />` | `inputClassName` for a class on the input itself, `dense`, `ref` reaches the input. |
| Switching views | `<UnderlineTabs ariaLabel="Month" tabs={ [ { id, label } ] } value onChange />` | Arrow keys work. `deselectable` when clicking the open tab closes it (`onChange(null)`). |
| A checkbox or radio | native `<input type="checkbox">` / `type="radio"` inside its `<label>` | Tinted by `accent-color: $color-background-action-high-contrast` (set globally); no custom box. |
| A status pill | `<Badge tone="neutral" \| "action" \| "status" \| "warning" \| "danger" title="…">Past</Badge>` | Uppercase by default; `uppercase={ false }` for names and prices. |
| Dialogs and settings | `ConfigPopup` (`lib/dashboard/config-popup.jsx`) | Title bar, close button, footer with Cancel + primary. |
| Tooltips | `DashboardTippy` (hint, or `rich`), `useStatsChartTooltip` for charts | See [Tooltips](#tooltips) for which look to use. |
| Charts | `charts/stats-chart.jsx` pieces (`ChartGridLines`, `ChartHighlightLine`, `ChartValuePill`, `ChartHitArea`, `ChartXAxisLabels`, `useElementSize`) | See `charts/peak-hours-chart.jsx` for a compact example. |

Every control forwards `ref` (for popout anchors and focus) and passes other attributes (`data-*`, `aria-*`, `role`,
`title`) through. The control classes (`dashboard-button`, `dashboard-icon-button`, …) are defined once in
`styles/dashboard-controls.scss` from the mixins in `styles/controls.scss`. If a control needs a new variant, add it
there, to the component, to its JSDoc, to `test/controls.test.js`, and to this table — never in a widget.

When something truly cannot be a shared control (a bespoke editor line, an auto-growing textarea), add it to
`ALLOWED_RAW_CONTROLS` in `test/controls-usage.test.js` with the reason. That test fails on raw `<button>`, `<select>`,
`<textarea>`, and text `<input>` elsewhere under `lib/`, on `href="#"` links, on spinner classes or spin keyframes
outside `dashboard-controls.scss`, and on any widget stylesheet that styles a control class.

## Tooltips

There are two tooltip looks. Pick by what the tooltip **contains**, not by where it appears.

| Look | Theme | Use when | Examples |
|---|---|---|---|
| **Hint** | `dashboard-hint` (the `DashboardTippy` default) | One or two plain sentences that explain a control or finish a truncated line. No title, rows, links, or markup. | Update indicator, planning suggestion note, cited-task chip, a truncated agenda reason |
| **Rich** | `dashboard-rich` — the host's Task Stats tooltip | Anything with structure: a title, label/value rows, several entries, rendered task text, or something to click. | Chart bars (Victory Value, Peak Hours, Energy Delta), mood days, Task Retirement Center task preview, Plan Builder focus window |

If you are unsure, it is rich. Never style tooltip content yourself; build it from the rich layout:

- **React content on a chart:** `useStatsChartTooltip()` with `StatsChartTooltipContent` and `StatsChartTooltipRow`
  (`charts/stats-chart-tooltip.jsx`).
- **HTML content** (element tooltips, canvas charts): `richTooltipHtml({ title, rows })` from
  `lib/dashboard/tooltip-themes.js`, shown with `<DashboardTippy rich content={ html }>` or
  `useCanvasTippy(RICH_TOOLTIP_OPTIONS)`. Rows take `text` (escaped) or trusted `html`, an optional right-aligned
  `trailing`, and an optional muted `secondaryText`; `stats-chart-tooltip-stat--section` and `--detail` row classes
  start and fill a sub-group (e.g. "Why this project").
- **Hints:** `<DashboardTippy content="Plain sentence.">`, or `HINT_TOOLTIP_THEME` for a bare `tippy()` call.
- An `IconButton`'s own `title`/`tooltip` is the native browser hint and needs no theme.

The host's Rich Footnote popup (`rich-footnote`, in `amplenote-markdown-render.scss`) is the third, host-owned look,
used only for footnotes inside rendered task text. `test/controls-usage.test.js` fails on any other tooltip theme.

## Making a widget

1. **Register it** in `WIDGET_REGISTRY` (`lib/dashboard/layout-profiles.js`): `widgetId`, `name`, `description`,
   default and maximum sizes.
2. **Give it an icon** in `WIDGET_ICON_BY_ID` (`lib/dashboard/widget-icons.jsx`).
3. **Write the component** inside `WidgetWrapper`, which draws the card, header icon, title, and subtitle:

```jsx
// Shows the user's open inbox tasks with a reseed action.
import { EmptyState, IconButton, LoadingState } from "dashboard/controls";
import { MdInbox, MdRefresh } from "react-icons/md";
import "styles/inbox.scss";
import WidgetWrapper from "widget-wrapper";

// ----------------------------------------------------------------------------------------------
// @desc Inbox widget: the open inbox tasks, or an empty state when there are none.
// @param {Object} props - { loading, onReseed, tasks }.
// @returns {JSX.Element} The widget.
export default function InboxWidget({ loading, onReseed, tasks }) {
  const headerActions = <IconButton Icon={ MdRefresh } label="Reseed" onClick={ onReseed } size="small" />;
  let body;
  if (loading) body = <LoadingState>Loading inbox…</LoadingState>;
  else if (!tasks.length) body = <EmptyState Icon={ MdInbox } title="Inbox zero">New tasks land here.</EmptyState>;
  else body = <ul className="inbox-task-list">{ tasks.map(task => <li key={ task.uuid }>{ task.content }</li>) }</ul>;
  return <WidgetWrapper headerActions={ headerActions } widgetId="inbox">{ body }</WidgetWrapper>;
}
```

```scss
// styles/inbox.scss — layout only; colors from tokens
@use 'theme-tokens' as *;

.widget-inbox {
  .inbox-task-list {
    display: flex;
    flex-direction: column;
    gap: $sp-sm;
    list-style: none;
  }
}
```

4. **Render it** from `lib/dashboard/dashboard.jsx` (`createWidgetCell`) and add tests.
5. **Check it** in `npm run dev` in light and dark mode and at phone width.

## Widget anatomy (for reference)

`WidgetWrapper` → card (`$color-background-primary`, 1px `$color-border-primary`, 8px corners) → header (18px icon in
`$color-text-low-contrast`, 12px uppercase 500 title in `$color-text-medium-contrast`, subtitle after "·", actions on
the right) → body (`4px 16px 16px` padding). Dialogs: `$color-background-dialog` title bar, 20px/500 title,
`$shadow-elevation-24`. Tooltips: `$color-background-popup`, `$shadow-elevation-3` (see [Tooltips](#tooltips)).

## Theme refresh

The plugin reads the host's theme with `app.context.getStyleProperties()` when the dashboard loads and again on window
focus, visibility, and pointer re-entry (`lib/dashboard/host-theme.js`), so every token above follows the user's theme.
Never cache a color in JavaScript; canvas or SVG code reads tokens through CSS (`fill: var(--dashboard-…)`) or
re-reads on the `dashboard-theme-change` event.
