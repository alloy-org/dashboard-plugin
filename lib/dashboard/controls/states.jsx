// Empty, loading, and error states for widget bodies and panels, so every widget says "nothing here",
// "loading", and "something failed" the same way.
import { MdErrorOutline } from "react-icons/md";
import Button from "dashboard/controls/button";
import classNameFromList from "dashboard/controls/class-names";
import Spinner from "dashboard/controls/spinner";
import "dashboard/styles/dashboard-controls.scss";

const EMPTY_STATE_ICON_SIZE = 32;

// ----------------------------------------------------------------------------------------------
// @desc A centered empty state: a faint icon, a short title, an optional sentence, and an optional action.
//   With `compact`, a single left-aligned line for a section inside a list (e.g. "No tasks scheduled" under a
//   day).
// @param {Object} props - An object with the following properties:
//   - {ReactNode} [action] - A Button (usually text or outlined), or several in a fragment.
//   - {ReactNode} [children] - One sentence saying what fills this space, or what to do.
//   - {string} [className] - Extra class names for layout.
//   - {boolean} [compact] - One inline line with no icon or padding.
//   - {Function} [Icon] - react-icons component for the faint icon (ignored when compact).
//   - {ReactNode} [title] - Short title, e.g. "No tasks scheduled for today".
//   - Other div attributes, such as `role="note"`, pass through.
// @returns {JSX.Element} The empty state.
export function EmptyState({ action, children, className, compact, Icon, title, ...rest }) {
  return (
    <div { ...rest } className={ classNameFromList("dashboard-empty-state",
      compact && "dashboard-empty-state--compact", className) }>
      {
        Icon && !compact
          ? <Icon className="dashboard-empty-state-icon" size={ EMPTY_STATE_ICON_SIZE } />
          : null
      }
      { title ? <div className="dashboard-empty-state-title">{ title }</div> : null }
      { children ? <div className="dashboard-empty-state-message">{ children }</div> : null }
      { action ? <div className="dashboard-empty-state-actions">{ action }</div> : null }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc A failure message with optional actions, in the empty state's layout, announced with role="alert".
// @param {Object} props - An object with the following properties:
//   - {ReactNode} [action] - Further actions shown before Retry, e.g. a "View source note" link Button.
//   - {ReactNode} [children] - Detail text.
//   - {string} [className] - Extra class names.
//   - {Function} [onRetry] - Shows a Retry button.
//   - {string} [retryLabel] - Retry button label (default "Retry").
//   - {ReactNode} [title] - Title (default "Something went wrong"); null for none.
//   - Other div attributes pass through.
// @returns {JSX.Element} The error state.
export function ErrorState({ action, children, className, onRetry, retryLabel = "Retry",
    title = "Something went wrong", ...rest }) {
  const retryButton = onRetry ? <Button onClick={ onRetry } variant="outlined">{ retryLabel }</Button> : null;
  return (
    <EmptyState role="alert" { ...rest }
      action={ action || retryButton ? <>{ action }{ retryButton }</> : null }
      className={ classNameFromList("dashboard-error-state", className) } Icon={ MdErrorOutline }
      title={ title }>
      { children }
    </EmptyState>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc A centered spinner with a short message, e.g. "Loading monthly task history…".
// @param {Object} props - { children, className, ...rest }: the message, extra class names, and div
//   attributes.
// @returns {JSX.Element} The loading state.
export function LoadingState({ children, className, ...rest }) {
  return (
    <div { ...rest } className={ classNameFromList("dashboard-loading-state", className) }>
      <Spinner />
      { children ? <div className="dashboard-loading-state-message">{ children }</div> : null }
    </div>
  );
}
