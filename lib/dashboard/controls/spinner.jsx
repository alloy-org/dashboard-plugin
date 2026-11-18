// The one loading spinner: a ring in the border color with an action-colored arc.
import classNameFromList from "dashboard/controls/class-names";
import "dashboard/styles/dashboard-controls.scss";

// ----------------------------------------------------------------------------------------------
// @desc An accessible spinner. Prefer LoadingState for a widget body; use Spinner inline (in a button, beside
//   text).
// @param {Object} props - { className, label, size }: extra class names for layout, accessible label (default
//   "Loading"), and "small" (16px), "medium" (24px, default), or "large" (32px).
// @returns {JSX.Element} The spinner.
export default function Spinner({ className, label = "Loading", size = "medium" }) {
  return (
    <span aria-label={ label }
      className={ classNameFromList("dashboard-spinner", `dashboard-spinner--${ size }`, className) }
      role="status" />
  );
}
