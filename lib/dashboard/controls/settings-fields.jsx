// Settings building blocks for ConfigPopup and other settings panels, so every widget's settings look the same: a
// section with a title, labeled fields, radio groups, and checkboxes on native inputs tinted with the action color.
import { useId } from "react";
import classNameFromList from "dashboard/controls/class-names";
import "dashboard/styles/dashboard-controls.scss";

// ----------------------------------------------------------------------------------------------
// @desc A single checkbox row: the box, its label, and an optional description line.
// @param {Object} props - An object with the following properties:
//   - {boolean} checked - Whether it is checked.
//   - {string} [className] - Extra class names for layout.
//   - {boolean} [compact] - The 13px inline size for toolbars and widget headers.
//   - {ReactNode} [description] - A muted line under the label.
//   - {boolean} [disabled] - Disables it.
//   - {ReactNode} label - What checking it does.
//   - {Function} onChange - Called with the new checked state (not the event).
//   - {string} [title] - Hover text.
// @returns {JSX.Element} The checkbox.
export function CheckboxField({ checked, className, compact, description, disabled, label, onChange, title }) {
  return (
    <label className={ classNameFromList("dashboard-option-row", compact && "dashboard-option-row--compact",
      description && "dashboard-option-row--described", className) } title={ title }>
      <input checked={ checked } disabled={ disabled } onChange={ event => onChange(event.target.checked) }
        type="checkbox" />
      <OptionText description={ description } label={ label } />
    </label>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc A labeled group of settings that are not a single radio group: a small label, an optional hint, then any
//   controls (a Select, a TextField, a CheckboxField, a link).
// @param {Object} props - { children, className, hint, label }: the controls, extra class names, a muted sentence
//   under the label, and the label.
// @returns {JSX.Element} The field.
export function ConfigField({ children, className, hint, label }) {
  const labelId = useId();
  return (
    <div aria-labelledby={ labelId } className={ classNameFromList("dashboard-config-field", className) } role="group">
      <div className="dashboard-config-field-label" id={ labelId }>{ label }</div>
      { hint ? <p className="dashboard-config-field-hint">{ hint }</p> : null }
      { children }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc A titled section of a settings panel, separated from the previous section by a hairline.
// @param {Object} props - { children, className, description, title }: the fields, extra class names, one sentence
//   about the section, and its title.
// @returns {JSX.Element} The section.
export function ConfigSection({ children, className, description, title }) {
  return (
    <section className={ classNameFromList("dashboard-config-section", className) }>
      <div className="dashboard-config-section-header">
        <h4 className="dashboard-config-section-title">{ title }</h4>
        { description ? <p className="dashboard-config-section-description">{ description }</p> : null }
      </div>
      { children }
    </section>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc A labeled radio group (a fieldset with its legend). Options with a description get a two-line row with a
//   hover fill, as in the AI provider picker.
// @param {Object} props - An object with the following properties:
//   - {string} [className] - Extra class names for layout.
//   - {boolean} [hideLabel] - Keep the legend for assistive technology only, e.g. when a popup title says it.
//   - {ReactNode} label - What the group chooses.
//   - {Function} onChange - Called with the chosen option's value.
//   - {Array<Object>} options - [{ description, disabled, label, value }].
//   - {string} value - The chosen value.
// @returns {JSX.Element} The group.
export function RadioGroup({ className, hideLabel, label, onChange, options, value }) {
  const name = useId();
  return (
    <fieldset className={ classNameFromList("dashboard-config-field", "dashboard-radio-group", className) }>
      <legend className={ classNameFromList("dashboard-config-field-label",
        hideLabel && "dashboard-config-field-label--hidden") }>{ label }</legend>
      {
        options.map(option => (
          <label className={ classNameFromList("dashboard-option-row",
            option.description && "dashboard-option-row--described") } key={ option.value }>
            <input checked={ value === option.value } disabled={ option.disabled } name={ name }
              onChange={ () => onChange(option.value) } type="radio" value={ option.value } />
            <OptionText description={ option.description } label={ option.label } />
          </label>
        ))
      }
    </fieldset>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc An option's label, with its description under it when there is one.
// @param {Object} props - { description, label }.
// @returns {JSX.Element} The text.
function OptionText({ description, label }) {
  if (!description) return <span className="dashboard-option-row-label">{ label }</span>;
  return (
    <span className="dashboard-option-row-text">
      <span className="dashboard-option-row-label">{ label }</span>
      <span className="dashboard-option-row-description">{ description }</span>
    </span>
  );
}
