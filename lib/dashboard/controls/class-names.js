// Joins class names, skipping empty ones, so controls never emit stray spaces.

// ----------------------------------------------------------------------------------------------
// @desc A class attribute from a list of class names, skipping falsy entries.
// @param {...(string|false|null|undefined)} classNames - Class names; falsy entries are skipped.
// @returns {string} The joined class names.
export default function classNameFromList(...classNames) {
  return classNames.filter(Boolean).join(" ");
}
