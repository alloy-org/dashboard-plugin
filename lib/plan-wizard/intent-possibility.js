// Validate an inferred or default intent suggestion independently of the user's chosen goals.

import { PLAN_MODEL_MARKER, assertUserCategory, copyJsonValue, requireRecord,
  requiredText } from "plan-wizard/plan-models";

// ----------------------------------------------------------------------------------------------
// @desc An inferred or default suggestion with explicit provenance and confidence.
// @property {number} confidence - Evidence confidence from 1 through 10.
// @property {Array<object>} evidence - Optional structured evidence references.
// @property {string} intent - Suggested broad outcome.
// @property {string} sourceKind - inferred or default.
// @property {string} substantiation - Explanation supporting the suggestion.
// @property {string} userCategoryEm - work or personal.
// @property {string} uuid - Stable identity reused when refreshing equivalent suggestion text.
export default class IntentPossibility {
  // ----------------------------------------------------------------------------------------------
  // @desc Construct a detached suggestion and reject unsupported provenance or confidence.
  // @param {object} record - Suggestion fields, including UUID and category.
  constructor(record) {
    const possibility = copyJsonValue(record);
    requireRecord(possibility);
    assertUserCategory(possibility.userCategoryEm);
    for (const field of ["intent", "substantiation", "uuid"]) {
      possibility[field] = requiredText(field, possibility[field]);
    }
    if (!Number.isFinite(possibility.confidence) || possibility.confidence < 1 || possibility.confidence > 10) {
      throw new Error("confidence must be between 1 and 10");
    }
    if (!["default", "inferred"].includes(possibility.sourceKind)) {
      throw new Error("sourceKind must be default or inferred");
    }
    possibility.evidence = possibility.evidence ?? [];
    if (!Array.isArray(possibility.evidence)) throw new Error("evidence must be an array");
    if (possibility.sourceKind === "default" && possibility.evidence.length) {
      throw new Error("Defaults cannot claim evidence");
    }
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(possibility));
    Object.defineProperty(this, PLAN_MODEL_MARKER, { value: true });
  }
}
