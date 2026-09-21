// Describe how intent inference read the user's notes, in the terms the wizard's reading page shows them: the notes
// and tasks that went into the prompt, the recurring themes the model found there, and the pin or dismiss judgement
// the user has passed on each theme. Judgements are fed back into the next inference prompt, which is how the page
// lets a user steer what Plan Builder sends to the model without editing the Vision Guide by hand. Host-compatible,
// since the service that runs inference imports it.

import { requireRecord, requiredText } from "plan-wizard/plan-models";

export const MAXIMUM_READ_ITEMS = 15;
export const MAXIMUM_THEMES = 6;
export const MAXIMUM_THEME_LABEL_LENGTH = 40;
export const THEME_JUDGEMENTS = ["dismissed", "pinned"];

// ----------------------------------------------------------------------------------------------
// @desc Normalize a theme label into the key its judgement is stored under, so "Hiring" and "hiring " are one theme.
// @param {string} label - Theme label as the model or the page wrote it.
// @returns {string} Lowercased, whitespace-collapsed key.
export function themeKey(label) {
  return String(label ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

// ----------------------------------------------------------------------------------------------
// @desc List the notes and tasks the prompt was built from, alternating between them so a short list still shows
//   both kinds of source, and capped so the page reads as a sample rather than a dump.
// @param {object} evidence - Bundle from collectIntentEvidence.
// @returns {Array<object>} Up to MAXIMUM_READ_ITEMS { kind, label, noteUuid, taskUuid } entries; kind is note or task.
export function readItemsFromEvidence(evidence) {
  const noteContext = evidence?.work?.noteContext ?? [];
  const taskReferences = evidence?.work?.references ?? [];
  const noteItems = noteContext.map(note => ({ kind: "note", label: note.noteName || "Untitled note",
    noteUuid: note.noteUuid ?? null, taskUuid: null }));
  const taskItems = taskReferences.map(reference => ({ kind: "task", label: reference.text,
    noteUuid: reference.noteUuid ?? null, taskUuid: reference.taskUuid ?? null }));
  const interleavedItems = [];
  for (let index = 0; index < Math.max(noteItems.length, taskItems.length); index += 1) {
    if (noteItems[index]) interleavedItems.push(noteItems[index]);
    if (taskItems[index]) interleavedItems.push(taskItems[index]);
  }
  const labeledItems = interleavedItems.filter(item => item.label && item.label.trim());
  const seenLabels = new Set();
  const distinctItems = labeledItems.filter(item => {
    const labelKey = `${ item.kind }:${ themeKey(item.label) }`;
    if (seenLabels.has(labelKey)) return false;
    seenLabels.add(labelKey);
    return true;
  });
  return distinctItems.slice(0, MAXIMUM_READ_ITEMS);
}

// ----------------------------------------------------------------------------------------------
// @desc Validate the themes a provider response named, discarding malformed entries rather than repairing them.
// @param {*} entries - Candidate themes from the response; any non-array value yields none.
// @param {number} taskCountCeiling - Number of tasks the prompt listed, which no theme's count may exceed.
// @returns {Array<object>} Up to MAXIMUM_THEMES distinct { label, taskCount } themes, in the order the model gave.
// A count is the model's own tally of the listed tasks, so it is clamped to what the prompt could have supported.
export function themesFromResponse(entries, taskCountCeiling) {
  if (!Array.isArray(entries)) return [];
  const themes = [];
  const seenKeys = new Set();
  for (const entry of entries) {
    const label = String(entry?.label ?? "").replace(/\s+/g, " ").trim().slice(0, MAXIMUM_THEME_LABEL_LENGTH);
    const key = themeKey(label);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    const reportedCount = Math.round(Number(entry?.taskCount));
    const taskCount = Number.isFinite(reportedCount) ? Math.min(Math.max(reportedCount, 0), taskCountCeiling) : 0;
    themes.push({ label, taskCount });
    if (themes.length >= MAXIMUM_THEMES) break;
  }
  return themes;
}

// ----------------------------------------------------------------------------------------------
// @desc Pull the themes that have arrived in full out of a JSON response that is still being streamed, so the
//   reading page can show each theme as the model writes it rather than waiting for the directions after it.
// @param {string} partialText - The response text received so far, which may end partway through any value.
// @param {number} taskCountCeiling - Number of tasks the prompt listed, passed through to themesFromResponse.
// @returns {Array<object>} The complete { label, taskCount } themes so far; an entry still being written is left out.
// Only braces outside string values are counted, so a label containing "{" or "}" cannot end an entry early.
export function themesFromPartialResponse(partialText, taskCountCeiling) {
  const themesMatch = /"themes"\s*:\s*\[/.exec(partialText ?? "");
  if (!themesMatch) return [];
  const completedEntries = [];
  let depth = 0;
  let entryStart = -1;
  let isEscaped = false;
  let isInString = false;
  for (let index = themesMatch.index + themesMatch[0].length; index < partialText.length; index += 1) {
    const character = partialText[index];
    if (isInString) {
      if (isEscaped) isEscaped = false;
      else if (character === "\\") isEscaped = true;
      else if (character === "\"") isInString = false;
    } else if (character === "\"") {
      isInString = true;
    } else if (character === "{") {
      if (depth === 0) entryStart = index;
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0 && entryStart !== -1) {
        try {
          completedEntries.push(JSON.parse(partialText.slice(entryStart, index + 1)));
        } catch (error) {
          // A malformed entry is skipped here just as themesFromResponse would discard it.
        }
        entryStart = -1;
      }
    } else if (character === "]" && depth === 0) {
      break;
    }
  }
  return themesFromResponse(completedEntries, taskCountCeiling);
}

// ----------------------------------------------------------------------------------------------
// @desc Leave out the themes the user has dismissed, which the model is asked to omit but may still report.
// @param {Array<object>} themes - { label, taskCount } themes from a response.
// @param {object} themeJudgements - Map of themeKey to { judgement, label }.
// @returns {Array<object>} The themes not dismissed, in their original order.
export function undismissedThemes(themes, themeJudgements = {}) {
  return themes.filter(theme => themeJudgements?.[themeKey(theme.label)]?.judgement !== "dismissed");
}

// ----------------------------------------------------------------------------------------------
// @desc Render the user's theme judgements as prompt guidance, so pinned themes are favored and dismissed ones are
//   neither proposed as intents nor reported back as themes.
// @param {object} themeJudgements - Map of themeKey to { judgement, label }.
// @returns {string} Guidance paragraph, or an empty string when the user has judged nothing.
export function themeGuidanceFromJudgements(themeJudgements = {}) {
  const judgedThemes = Object.values(themeJudgements ?? {});
  const pinnedLabels = judgedThemes.filter(theme => theme.judgement === "pinned").map(theme => theme.label);
  const dismissedLabels = judgedThemes.filter(theme => theme.judgement === "dismissed").map(theme => theme.label);
  const guidance = [];
  if (pinnedLabels.length) guidance.push(`The user pinned these themes as mattering this quarter; favor them: ${ pinnedLabels.join("; ") }.`);
  if (dismissedLabels.length) {
    guidance.push(`The user dismissed these themes as not mattering; do not base intents on them and leave them out of themes: ${ dismissedLabels.join("; ") }.`);
  }
  return guidance.join(" ");
}

// ----------------------------------------------------------------------------------------------
// @desc Apply one pin, dismiss, or clear to a stored judgement map without mutating it.
// @param {object} themeJudgements - Current map of themeKey to { judgement, label }.
// @param {string} label - Theme being judged.
// @param {string|null} judgement - pinned, dismissed, or null to clear an earlier judgement.
// @returns {object} The updated map.
export function themeJudgementsWithChange(themeJudgements, label, judgement) {
  const key = themeKey(label);
  if (!key) throw new Error("Theme label is required");
  if (judgement !== null && !THEME_JUDGEMENTS.includes(judgement)) throw new Error("Theme judgement must be pinned, dismissed, or null");
  const updatedJudgements = { ...(themeJudgements ?? {}) };
  if (judgement === null) {
    delete updatedJudgements[key];
    return updatedJudgements;
  }
  updatedJudgements[key] = { judgement, label: label.replace(/\s+/g, " ").trim() };
  return updatedJudgements;
}

// ----------------------------------------------------------------------------------------------
// @desc Validate the reading and theme judgements stored beside the professional suggestions, so a hand-edited
//   Vision Guide cannot hand the reading page a shape it would crash on.
// @param {object|undefined} reading - Stored { readItems, themes } envelope, absent before the first reading.
// @param {object|undefined} themeJudgements - Stored map of themeKey to { judgement, label }.
// @returns {object} { reading, themeJudgements } normalized; reading is null when none was stored.
export function validatedIntentReading(reading, themeJudgements) {
  let validatedReading = null;
  if (reading !== undefined && reading !== null) {
    requireRecord(reading);
    if (!Array.isArray(reading.readItems) || !Array.isArray(reading.themes)) throw new Error("Stored reading needs readItems and themes");
    const readItems = reading.readItems.map(item => {
      if (!["note", "task"].includes(item?.kind)) throw new Error("Stored read item kind must be note or task");
      return { ...item, label: requiredText("readItem.label", item.label) };
    });
    const themes = reading.themes.map(theme => ({ label: requiredText("theme.label", theme?.label),
      taskCount: Number.isFinite(theme.taskCount) ? theme.taskCount : 0 }));
    validatedReading = { ...reading, readItems, themes };
  }
  const validatedJudgements = {};
  for (const [key, theme] of Object.entries(themeJudgements ?? {})) {
    if (!THEME_JUDGEMENTS.includes(theme?.judgement)) throw new Error("Stored theme judgement must be pinned or dismissed");
    validatedJudgements[key] = { judgement: theme.judgement, label: requiredText("themeJudgement.label", theme.label) };
  }
  return { reading: validatedReading, themeJudgements: validatedJudgements };
}
