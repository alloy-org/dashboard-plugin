// Inline SVG Material icon, standing in for the Material Icons web font the host app uses.
import { MATERIAL_ICON_PATHS } from "constants/material-icon-paths";

const DEFAULT_ICON_SIZE = 18;

// ----------------------------------------------------------------------------------------------
// @desc Draw a Material icon in the current text color. Icons are decorative: the control that holds one carries its
//   own label (visible text, aria-label, or title), so the SVG is hidden from assistive technology.
// @param {string} className - Optional extra class names.
// @param {string} name - Material icon name, e.g. "refresh"; an unknown name renders nothing.
// @param {number} size - Width and height in pixels.
// @returns {JSX.Element|null} The icon, or null when no path data exists for the name.
export default function MaterialIcon({ className, name, size = DEFAULT_ICON_SIZE }) {
  const pathData = MATERIAL_ICON_PATHS[name];
  if (!pathData) return null;
  return (
    <svg aria-hidden="true" className={ `material-icon${ className ? ` ${ className }` : "" }` } fill="currentColor"
      focusable="false" height={ size } viewBox="0 0 24 24" width={ size }>
      <path d={ pathData } />
    </svg>
  );
}
