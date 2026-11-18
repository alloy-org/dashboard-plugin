// A button with no look of its own, for clickable cards, rows, and options whose layout the widget styles
// itself.
import { forwardRef } from "react";
import classNameFromList from "dashboard/controls/class-names";
import "dashboard/styles/dashboard-controls.scss";

// ----------------------------------------------------------------------------------------------
// @desc A `type="button"` button with the browser's button styling reset and the dashboard's focus ring. Use
//   it instead of a raw <button> whenever a card, row, or option is clickable; use Button or IconButton for
//   actual buttons. Forwards its ref, so popouts can anchor to it.
// @param {Object} props - { children, className, ...rest }: content, the widget's own class, and button
//   attributes.
// @param {Object} ref - Forwarded to the <button>.
// @returns {JSX.Element} The button.
function PlainButton({ children, className, ...rest }, ref) {
  return (
    <button { ...rest } className={ classNameFromList("dashboard-plain-button", className) } ref={ ref }
      type="button">
      { children }
    </button>
  );
}

export default forwardRef(PlainButton);
