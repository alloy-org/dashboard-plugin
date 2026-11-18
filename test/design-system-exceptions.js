// Features merged from main before the design system reached them. The design guard tests skip these paths; remove an
// entry once its feature is migrated (see doc/design-system.md). Paths are relative to lib/.
import path from "node:path";

// The Quarter Retrospective is a full-screen story with its own palette, motion, and video export
const NOT_YET_MIGRATED_PATHS = [ "dashboard/quarter-retrospective/", "dashboard/styles/quarter-retrospective.scss" ];

// ----------------------------------------------------------------------------------------------
// @desc Whether a file belongs to a feature the design system has not reached yet.
// @param {string} file - Absolute path under lib/.
// @returns {boolean} True when the guard tests should skip it.
export function isNotYetMigrated(file) {
  const relativePath = path.relative(path.resolve("lib"), file);
  return NOT_YET_MIGRATED_PATHS.some(prefix => relativePath.startsWith(prefix));
}
