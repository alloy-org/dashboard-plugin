// Small pill labels: Past, Recommended, new, Scheduled, and similar statuses.
import classNameFromList from "dashboard/controls/class-names";
import "dashboard/styles/dashboard-controls.scss";

const BADGE_TONES = [ "action", "danger", "neutral", "status", "warning" ];

// ----------------------------------------------------------------------------------------------
// @desc A pill badge.
// @param {Object} props - An object with the following properties:
//   - {ReactNode} children - The label.
//   - {string} [className] - Extra class names, e.g. for truncation width.
//   - {string} [tone] - "neutral" (default), "action", "status", "warning", or "danger".
//   - {boolean} [uppercase] - Set false for names and prices that must keep their casing (default true).
//   - Other span attributes, such as `title`, pass through.
// @returns {JSX.Element} The badge.
export default function Badge({ children, className, tone = "neutral", uppercase = true, ...rest }) {
  const resolvedTone = BADGE_TONES.includes(tone) ? tone : "neutral";
  return (
    <span { ...rest } className={ classNameFromList("dashboard-badge", `dashboard-badge--${ resolvedTone }`,
      !uppercase && "dashboard-badge--keep-case", className) }>
      { children }
    </span>
  );
}
