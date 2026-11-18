// Round icon-only button in the host app's MDC style, for header actions, navigation arrows, close, pin, and
// dismiss.
import { forwardRef, isValidElement } from "react";
import classNameFromList from "dashboard/controls/class-names";
import "dashboard/styles/dashboard-controls.scss";

const ICON_SIZE_BY_BUTTON_SIZE = { dialog: 24, large: 20, medium: 18, small: 18 };

// ----------------------------------------------------------------------------------------------
// @desc An icon-only button. Its `label` is required: it becomes the accessible name and, unless `tooltip`
//   says something longer, the hover tooltip, so an icon never ships without words. Forwards its ref.
// @param {Object} props - An object with the following properties:
//   - {string} [className] - Extra class names for layout or a context color (e.g. on a dark title bar).
//   - {boolean} [disabled] - Disables the button.
//   - {Function|JSX.Element} Icon - react-icons component to draw, or an icon element already built by the
//     caller.
//   - {string} label - What the button does, e.g. "Previous week".
//   - {Function} [onClick] - Click handler.
//   - {boolean} [pressed] - For toggles (pin, show/hide): sets aria-pressed and the pressed style.
//   - {string} [size] - "small" (28px, widget headers and rows), "medium" (32px, default), "large" (36px, the
//     dashboard header), or "dialog" (40px, a dialog title bar's close button).
//   - {string} [tone] - "danger" for destructive actions; omit otherwise.
//   - {string|false} [tooltip] - Hover text when it should say more than the label, e.g. "Reseed: get new
//     suggestions"; false when the caller draws its own tooltip (tippy), so no native one doubles it.
// @param {Object} ref - Forwarded to the <button>.
// @returns {JSX.Element} The button.
function IconButton({ className, disabled, Icon, label, onClick, pressed, size = "medium", tone, tooltip,
    ...rest }, ref) {
  const classNames = classNameFromList("dashboard-icon-button", `dashboard-icon-button--${ size }`,
    tone === "danger" && "dashboard-icon-button--danger", className);
  return (
    <button { ...rest } aria-label={ label } aria-pressed={ pressed } className={ classNames }
      disabled={ disabled } onClick={ onClick } ref={ ref }
      title={ tooltip === false ? undefined : tooltip || label } type="button">
      {
        isValidElement(Icon)
          ? Icon
          : <Icon size={ ICON_SIZE_BY_BUTTON_SIZE[size] || ICON_SIZE_BY_BUTTON_SIZE.medium } />
      }
    </button>
  );
}

export default forwardRef(IconButton);
