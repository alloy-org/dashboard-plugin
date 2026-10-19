// Labeled select and text fields in the host app's style.
import { forwardRef, useId } from "react";
import classNameFromList from "dashboard/controls/class-names";
import "dashboard/styles/dashboard-controls.scss";

// ----------------------------------------------------------------------------------------------
// @desc A labeled <select>. Pass `options` as [{ label, value }], or <option> children for anything more.
// @param {Object} props - An object with the following properties:
//   - {ReactNode} [children] - <option>/<optgroup> elements, used when `options` is not given.
//   - {string} [className] - Extra class names on the wrapper.
//   - {boolean} [dense] - The 32px height used in toolbars and rows (default 36px).
//   - {boolean} [hideLabel] - Keep the label for assistive technology only, for compact toolbars.
//   - {string} [id] - The field's id, when something else refers to it; generated otherwise.
//   - {ReactNode} label - Field label.
//   - {Function} onChange - Called with the selected value (not the event).
//   - {Array<Object>} [options] - [{ label, value }].
//   - {string} value - Selected value.
// @param {Object} ref - Forwarded to the <select>.
// @returns {JSX.Element} The field.
export const Select = forwardRef(function Select({ children, className, dense, hideLabel, id: requestedId,
    label, onChange, options, value, ...rest }, ref) {
  const generatedId = useId();
  const id = requestedId || generatedId;
  return (
    <div className={ classNameFromList("dashboard-field", dense && "dashboard-field--dense", className) }>
      <FieldLabel hidden={ hideLabel } id={ id }>{ label }</FieldLabel>
      <select { ...rest } className="dashboard-select" id={ id }
        onChange={ event => onChange(event.target.value) } ref={ ref } value={ value }>
        {
          options
            ? options.map(option => (
              <option key={ option.value } value={ option.value }>{ option.label }</option>
            ))
            : children
        }
      </select>
    </div>
  );
});

// ----------------------------------------------------------------------------------------------
// @desc A labeled text input, or a textarea when `multiline` is set.
// @param {Object} props - An object with the following properties:
//   - {string} [className] - Extra class names on the wrapper.
//   - {boolean} [dense] - The 32px height used in toolbars and rows (default 36px).
//   - {boolean} [hideLabel] - Keep the label for assistive technology only.
//   - {string} [id] - The field's id; generated otherwise.
//   - {string} [inputClassName] - Extra class names on the input itself, for width or alignment.
//   - {ReactNode} label - Field label (required even when hidden).
//   - {boolean} [multiline] - Render a textarea.
//   - {Function} onChange - Called with the text (not the event).
//   - {string} value - Current text.
//   - Other props (placeholder, type, rows, required, onKeyDown) pass to the input.
// @param {Object} ref - Forwarded to the <input> or <textarea>, e.g. to focus or auto-grow it.
// @returns {JSX.Element} The field.
export const TextField = forwardRef(function TextField({ className, dense, hideLabel, id: requestedId,
    inputClassName, label, multiline, onChange, value, ...rest }, ref) {
  const generatedId = useId();
  const id = requestedId || generatedId;
  const Field = multiline ? "textarea" : "input";
  return (
    <div className={ classNameFromList("dashboard-field", dense && "dashboard-field--dense", className) }>
      <FieldLabel hidden={ hideLabel } id={ id }>{ label }</FieldLabel>
      <Field { ...rest } className={ classNameFromList("dashboard-text-field",
        multiline && "dashboard-text-field--multiline", inputClassName) } id={ id }
        onChange={ event => onChange(event.target.value) } ref={ ref } value={ value } />
    </div>
  );
});

// ----------------------------------------------------------------------------------------------
// @desc The label above a field, or a visually hidden one.
// @param {Object} props - { children, hidden, id }: label text, whether to hide it visually, and the
//   field's id.
// @returns {JSX.Element} The label.
function FieldLabel({ children, hidden, id }) {
  return (
    <label className={ classNameFromList("dashboard-field-label", hidden && "dashboard-field-label--hidden") }
      htmlFor={ id }>{ children }</label>
  );
}
