// The development style guide at /styleguide: every token, icon, control, tooltip, chart, and dialog in the host's
// Classic or Plum theme, light or dark, so a regression shows at a glance and a widget author can see what exists.
import { Select, UnderlineTabs } from "dashboard/controls";
import { ICON_DEFAULTS } from "dashboard/icon-defaults";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { IconContext } from "react-icons";
// The dashboard's stylesheet: document reset, inlined Roboto, and the widget card styles the widget frames use
import "dashboard/styles/dashboard.scss";
import { ControlsSection, SettingsSection, StatesSection } from "./styleguide-controls";
import { ChartsSection, DialogSection, TooltipsSection, WidgetFrameSection } from "./styleguide-showcase";
import { ColorsSection, FoundationsSection, IconsSection } from "./styleguide-tokens";
import "./styleguide.scss";

const MODE_TABS = [ { id: "light", label: "Light" }, { id: "dark", label: "Dark" } ];
const SECTIONS = [
  { Component: ColorsSection, id: "colors", title: "Colors" },
  { Component: FoundationsSection, id: "foundations", title: "Type, spacing, corners, shadows" },
  { Component: IconsSection, id: "icons", title: "Icons" },
  { Component: ControlsSection, id: "controls", title: "Controls" },
  { Component: StatesSection, id: "states", title: "Empty, loading, and error states" },
  { Component: SettingsSection, id: "settings", title: "Settings" },
  { Component: TooltipsSection, id: "tooltips", title: "Tooltips" },
  { Component: ChartsSection, id: "charts", title: "Charts" },
  { Component: WidgetFrameSection, id: "widget-frame", title: "Widget frame" },
  { Component: DialogSection, id: "dialog", title: "Dialog" },
];
const THEME_OPTIONS = [ { label: "Classic", value: "classic" }, { label: "Plum", value: "plum" } ];
const THEME_STORAGE_KEY = "dashboard-styleguide-theme";

// ------------------------------------------------------------------------------------------
// @desc The style guide: a sticky bar with the theme and mode switchers and section links, then every section.
// @returns {JSX.Element} The page.
function StyleguideApp() {
  const [ theme, setTheme ] = useState(() => storedThemeChoice());
  const [ themeRevision, setThemeRevision ] = useState(0);
  useEffect(() => {
    let cancelled = false;
    applyHostTheme(theme).then(() => { if (!cancelled) setThemeRevision(revision => revision + 1); });
    try { localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme)); } catch (error) { /* private window */ }
    return () => { cancelled = true; };
  }, [ theme.mode, theme.name ]);
  return (
    <div className="styleguide-page">
      <header className="styleguide-bar">
        <h1 className="styleguide-title">Dashboard style guide</h1>
        <Select className="styleguide-theme-select" dense hideLabel label="Host theme"
          onChange={ name => setTheme({ ...theme, name }) } options={ THEME_OPTIONS } value={ theme.name } />
        <UnderlineTabs ariaLabel="Light or dark" onChange={ mode => setTheme({ ...theme, mode }) } tabs={ MODE_TABS }
          value={ theme.mode } />
        <nav className="styleguide-nav">
          { SECTIONS.map(section => <a href={ `#${ section.id }` } key={ section.id }>{ section.title }</a>) }
        </nav>
      </header>
      <main className="styleguide-main">
        {
          SECTIONS.map(({ Component, id, title }) => (
            <section className="styleguide-section" id={ id } key={ id }>
              <h2 className="styleguide-section-title">{ title }</h2>
              <Component themeRevision={ themeRevision } />
            </section>
          ))
        }
      </main>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Load a host theme from the dev server and apply it the way host-theme.js does in the dashboard: the host's
//   custom properties in a style element, the mode on the root, then the theme-change event charts listen for.
// @param {Object} theme - { mode, name }.
// @returns {Promise<void>} Resolves once applied.
async function applyHostTheme({ mode, name }) {
  const response = await fetch(`/api/theme-styles?mode=${ mode }&theme=${ name }`);
  const css = await response.text();
  let styleElement = document.getElementById("dashboard-host-theme");
  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.id = "dashboard-host-theme";
    document.head.appendChild(styleElement);
  }
  styleElement.textContent = css;
  document.documentElement.dataset.theme = mode;
  window.dispatchEvent(new Event("dashboard-theme-change"));
}

// ------------------------------------------------------------------------------------------
// @desc The theme chosen last time, or Classic in the system's mode.
// @returns {Object} { mode, name }.
function storedThemeChoice() {
  const systemMode = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  try {
    const stored = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || "null");
    if (stored && THEME_OPTIONS.some(option => option.value === stored.name)) return stored;
  } catch (error) { /* private window or bad value */ }
  return { mode: systemMode, name: "classic" };
}

createRoot(document.getElementById("styleguide-root")).render(
  <IconContext.Provider value={ ICON_DEFAULTS }>
    <StyleguideApp />
  </IconContext.Provider>
);
