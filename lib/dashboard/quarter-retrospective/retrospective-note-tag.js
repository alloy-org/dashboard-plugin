// The tag a Quarter Retrospective applies to every note it writes: the archived data and payoff ranking notes, the
// takeaways note, and each "Document how you did it" note. The user picks it on the options screen, where it starts
// as "planning/retrospective", and the choice is kept as a plugin setting so later retrospectives use it too.
import { DASHBOARD_NOTE_TAG, DEFAULT_PLANNING_TAG, DEFAULT_RETROSPECTIVE_TAG, SETTING_KEYS } from "constants/settings";
import { pluginSettings, updatePluginSetting } from "plugin-data";
import { logIfEnabled } from "util/log";
import { arrayFromFilterNotesResult } from "util/note-handles";

// The tag whose notes, and their subtags, are read for the options screen's suggestions.
const SUGGESTION_ROOT_TAG = "planning";
const MAXIMUM_TAG_SUGGESTIONS = 20;

// ----------------------------------------------------------------------------------------------
// @desc A tag as Amplenote stores one: lowercase, spaces as dashes, no leading "#", and nothing but letters, digits,
//   dashes, underscores, and the slashes that nest it.
// @param {string} text - The tag as typed.
// @returns {string|null} The tag, or null when nothing usable was typed.
export function normalizedRetrospectiveTag(text) {
  const lowercase = String(text || "").trim().toLowerCase().replace(/^#+/, "");
  const dashed = lowercase.replace(/\s+/g, "-");
  const allowed = dashed.replace(/[^a-z0-9_\-/]/g, "");
  const nested = allowed.replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
  return nested || null;
}

// ----------------------------------------------------------------------------------------------
// @desc The tag retrospective notes are given: the one chosen on the options screen, else "planning/retrospective".
// @returns {string} The tag.
export function retrospectiveNoteTag() {
  return normalizedRetrospectiveTag(pluginSettings()[SETTING_KEYS.RETROSPECTIVE_NOTE_TAG]) || DEFAULT_RETROSPECTIVE_TAG;
}

// ----------------------------------------------------------------------------------------------
// @desc The tags a note the Dashboard keeps for a retrospective is created with: the Dashboard's own tag and the
//   retrospective tag.
// @returns {Array<string>} The tags, without repeats.
export function retrospectiveNoteTags() {
  return [...new Set([DASHBOARD_NOTE_TAG, retrospectiveNoteTag()])];
}

// ----------------------------------------------------------------------------------------------
// @desc Tags to suggest on the options screen: the current and default retrospective tags, the planning notes' tag,
//   and the tags already on the user's planning notes. A failed lookup leaves just the known tags.
// @param {object} app - Amplenote API.
// @returns {Promise<Array<string>>} Up to twenty tags, the current one first.
export async function retrospectiveTagSuggestions(app) {
  const knownTags = [retrospectiveNoteTag(), DEFAULT_RETROSPECTIVE_TAG, pluginSettings()[SETTING_KEYS.PLANNING_NOTE_TAG] || DEFAULT_PLANNING_TAG];
  let noteTags = [];
  try {
    const planningNotes = await arrayFromFilterNotesResult(app.filterNotes({ tag: SUGGESTION_ROOT_TAG }));
    noteTags = planningNotes.flatMap(note => (Array.isArray(note?.tags) ? note.tags.map(String) : []));
  } catch (error) {
    logIfEnabled("[retrospective-note-tag] could not read the planning notes' tags", error?.message);
  }
  const usableTags = [...knownTags, ...noteTags.sort()].filter(tag => tag && tag !== DASHBOARD_NOTE_TAG);
  const suggestions = [...new Set(usableTags)].slice(0, MAXIMUM_TAG_SUGGESTIONS);
  return suggestions;
}

// ----------------------------------------------------------------------------------------------
// @desc Remember the tag chosen on the options screen for this and later retrospectives. A tag that normalizes to
//   nothing keeps the current one, and an unchanged tag isn't written again.
// @param {object} app - Amplenote API.
// @param {string} text - The tag as typed.
// @returns {string} The tag now in use.
export function saveRetrospectiveNoteTag(app, text) {
  const tag = normalizedRetrospectiveTag(text);
  if (!tag || tag === retrospectiveNoteTag()) return retrospectiveNoteTag();
  updatePluginSetting(SETTING_KEYS.RETROSPECTIVE_NOTE_TAG, tag);
  Promise.resolve().then(() => app.setSetting(SETTING_KEYS.RETROSPECTIVE_NOTE_TAG, tag)).catch(error => {
    logIfEnabled("[retrospective-note-tag] could not save the retrospective tag", error?.message);
  });
  return tag;
}
