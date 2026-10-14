// Text, outlined, raised, and inline-link buttons in the host app's MDC style. Use these for every labeled
// action; widgets add only layout (margins, alignment) through `className`.
import { forwardRef } from "react";
import classNameFromList from "dashboard/controls/class-names";
import "dashboard/styles/dashboard-controls.scss";

const BUTTON_TYPES = [ "button", "reset", "submit" ];
const BUTTON_VARIANTS = [ "link", "outlined", "raised", "text" ];
const DEFAULT_ICON_SIZE = 18;

// ----------------------------------------------------------------------------------------------
// @desc A labeled button. Renders a real link only when `href` is given, for actions that navigate; otherwise
//   a button that is `type="button"` unless `type="submit"` is asked for, so it never submits a form by
//   accident. Forwards its ref, so popouts can anchor to it.
// @param {Object} props - An object with the following properties:
//   - {ReactNode} children - The label.
//   - {string} [className] - Extra class names for layout.
//   - {boolean} [dense] - The 32px height used inside cards and rows (default 36px).
//   - {boolean} [disabled] - Disables the button.
//   - {string} [href] - Destination; renders an <a> instead of a <button>.
//   - {Function} [Icon] - react-icons component drawn before the label.
//   - {number} [iconSize] - Size of Icon and TrailingIcon in px (default 18; 16 suits dense card actions).
//   - {Function} [onClick] - Click handler.
//   - {string} [title] - Tooltip text when the label alone does not explain the action.
//   - {string} [tone] - "danger" for destructive actions (remove, delete); omit otherwise.
//   - {Function} [TrailingIcon] - react-icons component drawn after the label, e.g. MdArrowForward.
//   - {string} [type] - "button" (default) or "submit" for a form's submit button.
//   - {string} [variant] - "text" (default), "outlined", "raised" (the one primary action of a view), or
//     "link" (an action inside a sentence, drawn as link text in the sentence's own size).
// @param {Object} ref - Forwarded to the <button> or <a>.
// @returns {JSX.Element} The button.
function Button({ children, className, dense, disabled, href, Icon, iconSize = DEFAULT_ICON_SIZE, onClick,
    title, tone, TrailingIcon, type = "button", variant = "text", ...rest }, ref) {
  const resolvedVariant = BUTTON_VARIANTS.includes(variant) ? variant : "text";
  const classNames = classNameFromList("dashboard-button", `dashboard-button--${ resolvedVariant }`,
    dense && "dashboard-button--dense", tone === "danger" && "dashboard-button--danger", className);
  const content = (
    <>
      { Icon ? <Icon size={ iconSize } /> : null }
      { children }
      { TrailingIcon ? <TrailingIcon size={ iconSize } /> : null }
    </>
  );
  if (href) {
    return (
      <a { ...rest } aria-disabled={ disabled || undefined } className={ classNames } href={ href }
        onClick={ onClick } ref={ ref } title={ title }>{ content }</a>
    );
  }
  return (
    <button { ...rest } className={ classNames } disabled={ disabled } onClick={ onClick } ref={ ref }
      title={ title } type={ BUTTON_TYPES.includes(type) ? type : "button" }>
      { content }
    </button>
  );
}

export default forwardRef(Button);
