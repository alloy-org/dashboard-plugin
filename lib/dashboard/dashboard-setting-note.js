// [Claude claude-4.6-opus-high-thinking-authored file]
// Prompt summary: "create DashboardSettingNote class to find/create/parse a plugin settings note"
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { logIfEnabled } from "util/log";

const DASHBOARD_SETTING_NOTE_NAME = "Mission Control Dashboard: plugin settings";

// ------------------------------------------------------------------------------------------
// @desc Detects whether the user's locale uses 24-hour time (e.g. most of Europe) or meridian (am/pm).
// @returns {string} "24h" or "meridian"
// [Claude claude-4.6-opus-high-thinking] Task: detect locale time format for initial settings
// Prompt: "initialize time/week settings using data from the web client's locale"
function detectLocaleTimeFormat() {
  try {
    const { hourCycle } = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions();
    return (hourCycle === "h23" || hourCycle === "h24") ? "24h" : "meridian";
  } catch {
    return "meridian";
  }
}

// ------------------------------------------------------------------------------------------
// @desc Detects whether the user's locale begins the week on Sunday or Monday.
// @returns {string} "sunday" or "monday"
// [Claude claude-4.6-opus-high-thinking] Task: detect locale week start for initial settings
// Prompt: "initialize time/week settings using data from the web client's locale"
function detectLocaleWeekStart() {
  try {
    const locale = new Intl.Locale(navigator.language);
    const weekInfo = locale.weekInfo || locale.getWeekInfo?.();
    if (weekInfo?.firstDay === 7 || weekInfo?.firstDay === 0) return "sunday";
    return "monday";
  } catch {
    return "monday";
  }
}

// ------------------------------------------------------------------------------------------
// @desc Parses note content into a settings object. Each line is expected as "Key: value".
// @param {string|null} content - Raw note body text
// @returns {Object} Parsed settings keyed by lowercase setting name
// [Claude claude-4.6-opus-high-thinking] Task: parse plugin setting note content into settings map
// Prompt: "create DashboardSettingNote class to find/create/parse a plugin settings note"
function parseSettingNoteContent(content) {
  const settings = {};
  if (!content) return settings;
  for (const line of content.split("\n")) {
    const match = line.match(/^([^:]+):\s*(.+)/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim().toLowerCase();
    if (key === "time format") settings.timeFormat = value;
    if (key === "week format") settings.weekFormat = value;
  }
  return settings;
}

// ------------------------------------------------------------------------------------------
// @desc Serializes a settings object into note content with one "Key: value" line per setting.
// @param {Object} settings - Settings to serialize (timeFormat, weekFormat)
// @returns {string} Note body text
// [Claude claude-4.6-opus-high-thinking] Task: serialize settings object to note content
// Prompt: "create DashboardSettingNote class to find/create/parse a plugin settings note"
function buildSettingNoteContent(settings) {
  const lines = [];
  if (settings.timeFormat) lines.push(`Time format: ${ settings.timeFormat }`);
  if (settings.weekFormat) lines.push(`Week format: ${ settings.weekFormat }`);
  return lines.join("\n");
}

// ------------------------------------------------------------------------------------------
// @desc Manages a "Mission Control Dashboard: plugin settings" note for persisting dashboard
//   preferences (time format, week format). Creates the note as archived on first use, and
//   initializes settings from the user's locale when no prior values exist.
// [Claude claude-4.6-opus-high-thinking] Task: DashboardSettingNote class for plugin settings persistence
// Prompt: "create DashboardSettingNote class to find/create/parse a plugin settings note"
export default class DashboardSettingNote {
  constructor(app) {
    this._app = app;
    this._noteUUID = null;
    this._settings = null;
  }

  // ------------------------------------------------------------------------------------------
  // @desc Finds or creates the settings note and parses its content. When the note does not
  //   exist, creates it as archived and seeds it with locale-detected defaults.
  // @returns {Promise<{timeFormat: string, weekFormat: string}>} Current settings
  async load() {
    const existing = await this._app.findNote({ name: DASHBOARD_SETTING_NOTE_NAME, tags: [DASHBOARD_NOTE_TAG] });
    if (existing?.uuid) {
      this._noteUUID = existing.uuid;
      const content = await this._app.getNoteContent({ uuid: existing.uuid });
      this._settings = parseSettingNoteContent(content);
      if (!this._settings.timeFormat) this._settings.timeFormat = detectLocaleTimeFormat();
      if (!this._settings.weekFormat) this._settings.weekFormat = detectLocaleWeekStart();
      logIfEnabled("[DashboardSettingNote] loaded settings:", this._settings);
      return { ...this._settings };
    }

    this._settings = { timeFormat: detectLocaleTimeFormat(), weekFormat: detectLocaleWeekStart() };
    const uuid = await this._app.createNote(DASHBOARD_SETTING_NOTE_NAME, [DASHBOARD_NOTE_TAG], { archive: true });
    this._noteUUID = typeof uuid === "object" ? uuid.uuid : uuid;
    await this._app.replaceNoteContent({ uuid: this._noteUUID }, buildSettingNoteContent(this._settings));
    logIfEnabled("[DashboardSettingNote] created settings note:", this._noteUUID);
    return { ...this._settings };
  }

  // ------------------------------------------------------------------------------------------
  // @desc Persists updated settings to the note, merging with any existing values.
  // @param {Object} newSettings - Partial settings object with timeFormat and/or weekFormat
  // @returns {Promise<void>}
  async save(newSettings) {
    this._settings = { ...this._settings, ...newSettings };
    if (!this._noteUUID) {
      logIfEnabled("[DashboardSettingNote] no noteUUID; cannot save");
      return;
    }
    await this._app.replaceNoteContent({ uuid: this._noteUUID }, buildSettingNoteContent(this._settings));
    logIfEnabled("[DashboardSettingNote] saved settings:", this._settings);
  }

  get settings() { return this._settings ? { ...this._settings } : null; }
}

export { DASHBOARD_SETTING_NOTE_NAME, detectLocaleTimeFormat, detectLocaleWeekStart };
