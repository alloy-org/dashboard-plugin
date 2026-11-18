// Style guide sections for the foundations: every color token as it resolves in the current theme, the type,
// spacing, corner, and shadow scales, and every widget and layout profile icon.
import { LAYOUT_PROFILE_ICON_BY_ID, WIDGET_ICON_BY_ID } from "dashboard/widget-icons";
import { useMemo } from "react";

// Token groups, in display order, by the start of the token's name after --dashboard-
const COLOR_GROUPS = [
  { prefixes: [ "color-background-" ], title: "Surfaces and fills" },
  { prefixes: [ "color-text-" ], title: "Text" },
  { prefixes: [ "color-border-" ], title: "Lines" },
  { prefixes: [ "victory-value-color-" ], title: "Victory value scale" },
  { prefixes: [ "color-agenda-", "color-category-", "color-intent-", "color-mood-", "color-pace-",
    "color-project-window-", "color-task-count-" ], title: "Data colors (data-colors.scss)" },
  { prefixes: [ "color-" ], title: "Dashboard-only colors" },
];
const FONT_SAMPLES = [ { label: "Large heading", size: 20 }, { label: "Large", size: 16 }, { label: "Default", size: 14 },
  { label: "Smaller", size: 13 }, { label: "Label", size: 12 } ];
const RADIUS_SAMPLES = [ "mark", "sm", "lg", "pill" ];
const SHADOW_SAMPLES = [ "2", "3", "24" ];
const SPACING_SAMPLES = [ { name: "xs", size: 4 }, { name: "sm", size: 8 }, { name: "md", size: 12 }, { name: "lg", size: 16 },
  { name: "xl", size: 24 } ];

// ------------------------------------------------------------------------------------------
// @desc Every --dashboard-* color custom property defined in the loaded stylesheets, grouped by role, each with its
//   swatch and the value it resolves to in the current theme.
// @param {Object} props - { themeRevision }: changes when the theme does, so values are read again.
// @returns {JSX.Element} The section body.
export function ColorsSection({ themeRevision }) {
  const groups = useMemo(() => colorGroupsFromNames(colorTokenNames()), []);
  const computedStyle = getComputedStyle(document.documentElement);
  return (
    <div className="styleguide-color-groups" data-revision={ themeRevision }>
      {
        groups.map(group => (
          <div className="styleguide-color-group" key={ group.title }>
            <h3 className="styleguide-subtitle">{ group.title }</h3>
            <div className="styleguide-swatch-grid">
              {
                group.names.map(name => (
                  <div className="styleguide-swatch" key={ name }>
                    <span className="styleguide-swatch-chip" style={ { background: `var(${ name })` } } />
                    <span className="styleguide-swatch-name">{ name.replace("--dashboard-", "") }</span>
                    <span className="styleguide-swatch-value">{ computedStyle.getPropertyValue(name).trim() }</span>
                  </div>
                ))
              }
            </div>
          </div>
        ))
      }
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc The type scale, spacing steps, corner radii, and elevation shadows, drawn with the real tokens.
// @returns {JSX.Element} The section body.
export function FoundationsSection() {
  return (
    <div className="styleguide-foundations">
      <div>
        <h3 className="styleguide-subtitle">Type (Roboto; weights 400 and 500 only)</h3>
        {
          FONT_SAMPLES.map(sample => (
            <p className="styleguide-type-sample" key={ sample.label } style={ { fontSize: sample.size } }>
              { `${ sample.label } ${ sample.size }px` } <span className="styleguide-type-medium">medium 500</span>
            </p>
          ))
        }
      </div>
      <div>
        <h3 className="styleguide-subtitle">Spacing ($sp-*)</h3>
        {
          SPACING_SAMPLES.map(sample => (
            <div className="styleguide-spacing-row" key={ sample.name }>
              <span className="styleguide-spacing-bar" style={ { width: sample.size } } />
              { `$sp-${ sample.name } ${ sample.size }px` }
            </div>
          ))
        }
      </div>
      <div>
        <h3 className="styleguide-subtitle">Corners ($radius-*)</h3>
        <div className="styleguide-tile-row">
          { RADIUS_SAMPLES.map(name => <div className={ `styleguide-tile styleguide-radius-${ name }` } key={ name }>{ name }</div>) }
        </div>
      </div>
      <div>
        <h3 className="styleguide-subtitle">Shadows ($shadow-elevation-*)</h3>
        <div className="styleguide-tile-row">
          { SHADOW_SAMPLES.map(name => <div className={ `styleguide-tile styleguide-shadow-${ name }` } key={ name }>{ name }</div>) }
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Every widget icon and layout profile icon, with the id it belongs to.
// @returns {JSX.Element} The section body.
export function IconsSection() {
  const iconGroups = [ { icons: WIDGET_ICON_BY_ID, title: "Widgets (widget-icons.jsx)" },
    { icons: LAYOUT_PROFILE_ICON_BY_ID, title: "Layout profiles" } ];
  return (
    <div>
      {
        iconGroups.map(group => (
          <div key={ group.title }>
            <h3 className="styleguide-subtitle">{ group.title }</h3>
            <div className="styleguide-icon-grid">
              {
                Object.entries(group.icons).map(([ id, Icon ]) => (
                  <div className="styleguide-icon-cell" key={ id }><Icon size={ 24 } /><span>{ id }</span></div>
                ))
              }
            </div>
          </div>
        ))
      }
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Sort token names into the display groups; each name goes to the first group whose prefix it starts with.
// @param {Array<string>} names - Custom property names.
// @returns {Array<Object>} [{ names, title }] for groups with at least one name.
function colorGroupsFromNames(names) {
  const groups = COLOR_GROUPS.map(group => ({ ...group, names: [] }));
  names.forEach(name => {
    const shortName = name.replace("--dashboard-", "");
    groups.find(group => group.prefixes.some(prefix => shortName.startsWith(prefix)))?.names.push(name);
  });
  return groups.filter(group => group.names.length);
}

// ------------------------------------------------------------------------------------------
// @desc The names of the color custom properties the dashboard defines, read from the loaded stylesheets so a new
//   token shows up here without editing the style guide.
// @returns {Array<string>} Sorted unique names.
function colorTokenNames() {
  const names = new Set();
  const collect = rules => Array.from(rules || []).forEach(rule => {
    if (rule.style) Array.from(rule.style).filter(name => /^--dashboard-(color|victory-value-color)-/.test(name))
      .forEach(name => names.add(name));
    if (rule.cssRules) collect(rule.cssRules);
  });
  Array.from(document.styleSheets).forEach(sheet => {
    try { collect(sheet.cssRules); } catch (error) { /* a cross-origin sheet */ }
  });
  return [ ...names ].sort();
}
