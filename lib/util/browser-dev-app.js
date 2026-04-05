/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: Browser-side dev app — full simulation of Amplenote plugin app interface
 * Prompt summary: "dev app simulates all app functions, reducing or eliminating callPlugin"
 */

import { logIfEnabled } from "util/log";

const CONSOLE_LOGGING_KEY = "Console logging";
function _widgetConfigKey(widgetId) { return `dashboard_${widgetId}_config`; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _resolveUUID(noteHandle) {
  return typeof noteHandle === "string" ? noteHandle : noteHandle?.uuid;
}

function _parseHeadingsFromMarkdown(content) {
  const matches = content.match(/^(#{1,6})\s+(.+)$/gm) || [];
  return matches.map((line, i) => ({
    heading: {
      text: line.replace(/^#{1,6}\s+/, '').trim(),
      level: (line.match(/^#+/) || [''])[0].length,
    },
    index: i,
  }));
}

function _millisFromUnix(unixSec) {
  if (unixSec == null) return null;
  return unixSec < 1e10 ? unixSec * 1000 : unixSec;
}

function _getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function _filterTodayTasks(tasks, now) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = dayStart + 86400000;
  return tasks.filter(t => {
    const ms = _millisFromUnix(t.startAt);
    return !t.completedAt && !t.dismissedAt && ms != null && ms >= dayStart && ms < dayEnd;
  });
}

function _filterCompletedInWeek(tasks, weekStart) {
  const start = weekStart.getTime();
  const end = start + 7 * 86400000;
  return tasks.filter(t => {
    const ms = _millisFromUnix(t.completedAt);
    return ms != null && ms >= start && ms < end;
  });
}

function _calcWeeklyVictoryValue(tasks, weekStart) {
  return _filterCompletedInWeek(tasks, weekStart).reduce((sum, t) => sum + (t.victoryValue || 0), 0);
}

function _calcDailyVictoryValues(tasks, weekStart) {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return names.map((day, i) => {
    const dayStart = new Date(weekStart);
    dayStart.setDate(dayStart.getDate() + i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayTasks = tasks.filter(t => {
      const ms = _millisFromUnix(t.completedAt);
      return ms != null && ms >= dayStart.getTime() && ms < dayEnd.getTime();
    });
    return {
      day,
      date: dayStart.toISOString(),
      value: dayTasks.reduce((sum, t) => sum + (t.victoryValue || 0), 0),
      taskCount: dayTasks.length,
    };
  });
}

function _quarterMonthNames(quarter) {
  const allMonths = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const start = (quarter - 1) * 3;
  return [allMonths[start], allMonths[start + 1], allMonths[start + 2]];
}

// [Claude gpt-5.3-codex] Task: convert Amplenote prompt input descriptors into one-line HTML form controls
// Prompt: "Mock app.prompt in dev environment as the simplest possible modal window that transforms an array of inputs into lines within an HTML form"
function _buildPromptLine(input, idx) {
  const line = document.createElement("label");
  line.style.display = "flex";
  line.style.alignItems = "center";
  line.style.gap = "10px";

  const label = document.createElement("span");
  label.textContent = input?.label || `Input ${idx + 1}`;
  label.style.minWidth = "140px";
  line.appendChild(label);

  const fieldWrap = document.createElement("div");
  fieldWrap.style.flex = "1";
  line.appendChild(fieldWrap);

  const type = input?.type || "text";
  const options = Array.isArray(input?.options) ? input.options : [];

  if (type === "checkbox") {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(input?.value);
    fieldWrap.appendChild(checkbox);
    return { line, focusTarget: checkbox, getValue: () => checkbox.checked };
  }

  if (type === "radio") {
    const group = document.createElement("div");
    group.style.display = "flex";
    group.style.flexWrap = "wrap";
    group.style.gap = "10px";
    const radioName = `dev-prompt-radio-${Date.now()}-${idx}`;
    let firstRadio = null;
    for (const [optionIdx, option] of options.entries()) {
      const optionLabel = document.createElement("label");
      optionLabel.style.display = "inline-flex";
      optionLabel.style.alignItems = "center";
      optionLabel.style.gap = "4px";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = radioName;
      radio.value = String(option?.value ?? option?.label ?? "");
      if (input?.value != null && String(input.value) === radio.value) radio.checked = true;
      if (!firstRadio) firstRadio = radio;
      const text = document.createElement("span");
      text.textContent = option?.label ?? radio.value;
      optionLabel.append(radio, text);
      group.appendChild(optionLabel);
      if (optionIdx === options.length - 1 && !group.querySelector("input:checked") && firstRadio) {
        firstRadio.checked = true;
      }
    }
    fieldWrap.appendChild(group);
    return {
      line,
      focusTarget: firstRadio,
      getValue: () => {
        const selected = group.querySelector("input:checked");
        return selected ? selected.value : null;
      }
    };
  }

  if (type === "select") {
    const select = document.createElement("select");
    select.style.width = "100%";
    for (const option of options) {
      const opt = document.createElement("option");
      opt.value = String(option?.value ?? option?.label ?? "");
      opt.textContent = option?.label ?? opt.value;
      select.appendChild(opt);
    }
    if (input?.value != null) select.value = String(input.value);
    fieldWrap.appendChild(select);
    return { line, focusTarget: select, getValue: () => select.value };
  }

  if (type === "date") {
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    if (input?.value != null) {
      const date = new Date(_millisFromUnix(Number(input.value)));
      if (!Number.isNaN(date.getTime())) {
        dateInput.value = date.toISOString().slice(0, 10);
      }
    }
    dateInput.style.width = "100%";
    fieldWrap.appendChild(dateInput);
    return {
      line,
      focusTarget: dateInput,
      getValue: () => {
        if (!dateInput.value) return null;
        const parsed = Date.parse(`${dateInput.value}T00:00:00Z`);
        return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
      }
    };
  }

  if (type === "text") {
    const textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.style.width = "100%";
    textarea.value = String(input?.value ?? "");
    if (input?.placeholder) textarea.placeholder = input.placeholder;
    fieldWrap.appendChild(textarea);
    return { line, focusTarget: textarea, getValue: () => textarea.value };
  }

  const textInput = document.createElement("input");
  textInput.type = type === "secureText" ? "password" : "text";
  textInput.style.width = "100%";
  textInput.value = String(input?.value ?? "");
  if (input?.placeholder) textInput.placeholder = input.placeholder;
  fieldWrap.appendChild(textInput);
  return { line, focusTarget: textInput, getValue: () => textInput.value };
}

// [Claude gpt-5.3-codex] Task: implement simple modal-backed app.prompt for browser dev mode
// Prompt: "Mock app.prompt in dev environment as the simplest possible modal window that transforms an array of inputs into lines within an HTML form"
function _showSimplePromptModal(message, options = {}) {
  if (typeof document === "undefined") return Promise.resolve(null);

  const inputs = Array.isArray(options?.inputs) && options.inputs.length > 0
    ? options.inputs
    : [{ type: "text" }];
  const actions = Array.isArray(options?.actions) ? options.actions : [];

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.dataset.devPrompt = "overlay";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.35)";
    overlay.style.zIndex = "99999";
    overlay.style.display = "grid";
    overlay.style.placeItems = "center";

    const panel = document.createElement("div");
    panel.style.width = "min(680px, 92vw)";
    panel.style.background = "#fff";
    panel.style.color = "#111";
    panel.style.borderRadius = "10px";
    panel.style.padding = "16px";
    panel.style.boxShadow = "0 16px 48px rgba(0,0,0,0.25)";
    overlay.appendChild(panel);

    const heading = document.createElement("div");
    heading.textContent = String(message ?? "Prompt");
    heading.style.fontWeight = "600";
    heading.style.marginBottom = "12px";
    panel.appendChild(heading);

    const form = document.createElement("form");
    form.style.display = "flex";
    form.style.flexDirection = "column";
    form.style.gap = "10px";
    panel.appendChild(form);

    const controls = inputs.map((input, idx) => _buildPromptLine(input, idx));
    for (const control of controls) {
      form.appendChild(control.line);
    }

    const buttonRow = document.createElement("div");
    buttonRow.style.display = "flex";
    buttonRow.style.justifyContent = "flex-end";
    buttonRow.style.gap = "8px";
    buttonRow.style.marginTop = "8px";
    form.appendChild(buttonRow);

    let selectedAction = -1;
    for (const [actionIdx, action] of actions.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action?.label || `Action ${actionIdx + 1}`;
      button.addEventListener("click", () => {
        selectedAction = action?.value ?? actionIdx;
        form.requestSubmit();
      });
      buttonRow.appendChild(button);
    }

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.dataset.devPromptCancel = "true";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      overlay.remove();
      resolve(null);
    });
    buttonRow.appendChild(cancel);

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Submit";
    buttonRow.appendChild(submit);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = controls.map(control => control.getValue());
      overlay.remove();
      if (values.length === 1 && actions.length === 0) {
        resolve(values[0]);
      } else if (actions.length === 0) {
        resolve(values);
      } else {
        resolve([...values, selectedAction]);
      }
    });

    document.body.appendChild(overlay);
    const focusTarget = controls.find(c => c.focusTarget)?.focusTarget;
    if (focusTarget) focusTarget.focus();
  });
}

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

let _persistedSettings = null;

async function _loadSettings() {
  if (_persistedSettings !== null) return _persistedSettings;
  try {
    const res = await fetch("/api/settings");
    _persistedSettings = await res.json();
  } catch {
    _persistedSettings = {};
  }
  return _persistedSettings;
}

async function _saveSetting(key, value) {
  const settings = await _loadSettings();
  settings[key] = value;
  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  } catch (err) {
    console.warn("[dev-app] failed to persist setting", key, err);
  }
}

// ---------------------------------------------------------------------------
// Task fetching
// ---------------------------------------------------------------------------

async function _fetchAllTasks() {
  try {
    const res = await fetch("/api/tasks");
    return await res.json();
  } catch {
    return [];
  }
}

async function _fetchCompletedTasksInRange(fromSec, toSec) {
  try {
    const res = await fetch(`/api/tasks?from=${fromSec}&to=${toSec}`);
    return await res.json();
  } catch {
    return [];
  }
}

async function _fetchMoodRatings(fromSec) {
  try {
    const url = fromSec ? `/api/moods?from=${fromSec}` : '/api/moods';
    const res = await fetch(url);
    return await res.json();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Domain data
// ---------------------------------------------------------------------------

const _SAMPLE_NOTE_HANDLES = {
  "domain-work-uuid": [
    { uuid: "note-work-1",  name: "Q1 Goal Review" },
    { uuid: "note-work-2",  name: "Stand-up Notes" },
    { uuid: "note-work-3",  name: "Feature Implementation" },
    { uuid: "note-work-4",  name: "Design Feedback" },
    { uuid: "note-work-5",  name: "Budget Tracker" },
    { uuid: "note-work-6",  name: "Offline Testing" },
    { uuid: "note-work-7",  name: "Sprint Retro" },
    { uuid: "note-work-8",  name: "API Layer Research" },
    { uuid: "note-work-9",  name: "Integration Tests" },
    { uuid: "note-work-10", name: "Pull Request Queue" },
    { uuid: "note-work-11", name: "Settings Module Tests" },
    { uuid: "note-work-12", name: "CSS Cleanup" },
    { uuid: "note-work-13", name: "Dashboard Memory Leak" },
    { uuid: "note-work-14", name: "Client Feedback" },
    { uuid: "note-work-15", name: "API Error Handling" },
    { uuid: "note-work-16", name: "Auth Token Refresh" },
    { uuid: "note-work-17", name: "DB Query Performance" },
  ],
  "domain-personal-uuid": [
    { uuid: "note-personal-1",  name: "Networking Outreach" },
    { uuid: "note-personal-2",  name: "Fitness Log" },
    { uuid: "note-personal-3",  name: "Social Reminders" },
    { uuid: "note-personal-4",  name: "Entertainment" },
    { uuid: "note-personal-5",  name: "Shopping List" },
    { uuid: "note-personal-6",  name: "Health Appointments" },
    { uuid: "note-personal-7",  name: "Reading List" },
    { uuid: "note-personal-8",  name: "Hobbies" },
    { uuid: "note-personal-9",  name: "Trip Planning" },
    { uuid: "note-personal-10", name: "Home Office" },
  ],
  "domain-side-uuid": [
    { uuid: "note-side-1", name: "Blog Post Ideas" },
    { uuid: "note-side-2", name: "Side Project README" },
    { uuid: "note-side-3", name: "CI Pipeline Setup" },
  ],
};

const _SAMPLE_DOMAINS_WITH_NOTES = [
  { name: "Work",          uuid: "domain-work-uuid",     notes: _SAMPLE_NOTE_HANDLES["domain-work-uuid"] },
  { name: "Personal",      uuid: "domain-personal-uuid", notes: _SAMPLE_NOTE_HANDLES["domain-personal-uuid"] },
  { name: "Side Projects", uuid: "domain-side-uuid",     notes: _SAMPLE_NOTE_HANDLES["domain-side-uuid"] },
];

// ---------------------------------------------------------------------------
// Note helpers via dev server API
// ---------------------------------------------------------------------------

async function _findNoteByName(name) {
  try {
    const res = await fetch(`/api/note-find?name=${encodeURIComponent(name)}`);
    return await res.json();
  } catch {
    return null;
  }
}

async function _fetchNoteSections(uuid) {
  try {
    const app = createBrowserDevApp();
    const content = await app.getNoteContent(uuid);
    return _parseHeadingsFromMarkdown(content || '');
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Dev App Factory
// ---------------------------------------------------------------------------

let _instance = null;

// [Claude] Task: full browser-side dev app simulating all Amplenote plugin functionality
// Prompt: "dev app simulates all requisite functionality provided by the plugin environment"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export function createBrowserDevApp() {
  if (_instance) return _instance;

  const _navigate = (url) => {
    const isValid = /^https:\/\/www\.amplenote\.com\/notes(?:$|[/?].*)/.test(url);
    if (isValid) {
      console.log("[dev-app] navigate", url);
    } else {
      console.warn("[dev-app] navigate rejected invalid URL", url);
    }
    return isValid;
  };

  _instance = {
    settings: {},

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------
    async init() {
      const settings = await _loadSettings();
      if (!settings[CONSOLE_LOGGING_KEY]) settings[CONSOLE_LOGGING_KEY] = "true";

      if (typeof settings.dashboard_elements === "string") {
        try { settings.dashboard_elements = JSON.parse(settings.dashboard_elements); }
        catch { settings.dashboard_elements = null; }
      }
      for (const key of [_widgetConfigKey("victory-value"), _widgetConfigKey("calendar"), _widgetConfigKey("mood"), _widgetConfigKey("quotes")]) {
        if (typeof settings[key] === "string") {
          try { settings[key] = JSON.parse(settings[key]); }
          catch { settings[key] = null; }
        }
      }

      const now = new Date();
      const weekStart = _getWeekStart(now);
      const tasks = await _fetchAllTasks();
      const moodRatings = await _fetchMoodRatings();

      const currentQuarter = Math.ceil((now.getMonth() + 1) / 3);
      const currentLabel = `Q${currentQuarter} ${now.getFullYear()}`;
      const nextQuarter = currentQuarter === 4 ? 1 : currentQuarter + 1;
      const nextYear = currentQuarter === 4 ? now.getFullYear() + 1 : now.getFullYear();
      const nextLabel = `Q${nextQuarter} ${nextYear}`;

      const [currentFound, nextFound] = await Promise.all([
        _findNoteByName(`${currentLabel} Plan`),
        _findNoteByName(`${nextLabel} Plan`),
      ]);

      const [currentSections, nextSections] = await Promise.all([
        currentFound?.uuid ? _fetchNoteSections(currentFound.uuid) : Promise.resolve([]),
        nextFound?.uuid    ? _fetchNoteSections(nextFound.uuid)    : Promise.resolve([]),
      ]);
      const currentMonths = _quarterMonthNames(currentQuarter);
      const nextMonths    = _quarterMonthNames(nextQuarter);
      const currentHasAll = currentMonths.every(m => currentSections.some(s => s.heading?.text?.trim().toLowerCase() === m.toLowerCase()));
      const nextHasAll    = nextMonths.every(m => nextSections.some(s => s.heading?.text?.trim().toLowerCase() === m.toLowerCase()));

      _instance.settings = settings;

      return {
        tasks,
        todayTasks: _filterTodayTasks(tasks, now),
        completedThisWeek: _filterCompletedInWeek(tasks, weekStart),
        weeklyVictoryValue: _calcWeeklyVictoryValue(tasks, weekStart),
        dailyVictoryValues: _calcDailyVictoryValues(tasks, weekStart),
        moodRatings,
        quarterlyPlans: {
          current: {
            year: now.getFullYear(),
            quarter: currentQuarter,
            label: currentLabel,
            noteUUID: currentFound?.uuid ?? null,
            hasAllMonthlyDetails: currentHasAll,
          },
          next: {
            year: nextYear,
            quarter: nextQuarter,
            label: nextLabel,
            noteUUID: nextFound?.uuid ?? null,
            hasAllMonthlyDetails: nextHasAll,
          },
        },
        currentDate: now.toISOString(),
        settings,
        taskDomains: [
          { name: "Work", uuid: "domain-work-uuid" },
          { name: "Personal", uuid: "domain-personal-uuid" },
          { name: "Side Projects", uuid: "domain-side-uuid" }
        ],
        activeTaskDomain: "domain-work-uuid"
      };
    },

    // ------------------------------------------------------------------
    // Configure (no-op in dev)
    // ------------------------------------------------------------------
    async configure() {
      return null;
    },

    // ------------------------------------------------------------------
    // Data fetching
    // ------------------------------------------------------------------
    async getMoodRatings(fromSec) {
      return _fetchMoodRatings(fromSec);
    },

    async getCompletedTasks(fromSec, toSec) {
      return _fetchCompletedTasksInRange(fromSec, toSec);
    },

    async getTaskDomains() {
      return _SAMPLE_DOMAINS_WITH_NOTES;
    },

    // [Claude] Task: pass domain UUID to tasks API for tag-based filtering
    // Prompt: "search notes directory for tags matching the task domain"
    // Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
    async getTaskDomainTasks(domainUuid) {
      const url = domainUuid ? `/api/tasks?domain=${encodeURIComponent(domainUuid)}` : '/api/tasks';
      const res = await fetch(url);
      return await res.json();
    },

    async getNoteTasks(noteUUID, _options) {
      const tasks = await _fetchAllTasks();
      return tasks.filter(t => t.noteUUID === noteUUID && t.completedAt == null && t.dismissedAt == null);
    },

    // ------------------------------------------------------------------
    // Navigation (app.navigate is the real Amplenote API)
    // ------------------------------------------------------------------
    navigate(url) {
      return _navigate(url);
    },

    // ------------------------------------------------------------------
    // Settings persistence (app.setSetting is the real Amplenote API)
    // ------------------------------------------------------------------
    async setSetting(key, value) {
      const strValue = value == null ? '' : String(value);
      _instance.settings[key] = strValue;
      await _saveSetting(key, strValue);
    },

    // ------------------------------------------------------------------
    // Mood
    // ------------------------------------------------------------------
    // [Claude] Task: persist mood ratings through dev server API for dev-mode data continuity
    // Prompt: "update the dev environment to ensure that the call to updateMoodRating results in persisted data"
    // Date: 2026-03-24 | Model: claude-4.6-opus-high-thinking
    async recordMoodRating(value) {
      try {
        const res = await fetch('/api/moods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
        const data = await res.json();
        return data.uuid;
      } catch (err) {
        logIfEnabled('[dev-app] recordMoodRating failed:', err);
        return null;
      }
    },

    async updateMoodRating(moodRatingUUID, updates) {
      try {
        await fetch('/api/moods', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid: moodRatingUUID, updates }),
        });
      } catch (err) {
        logIfEnabled('[dev-app] updateMoodRating failed:', err);
      }
    },

    // ------------------------------------------------------------------
    // Notes
    // ------------------------------------------------------------------
    async getNoteContent(noteHandle) {
      const uuid = _resolveUUID(noteHandle);
      try {
        const res = await fetch(`/api/note-content?uuid=${encodeURIComponent(uuid)}`);
        const data = await res.json();
        return data.content ?? '';
      } catch {
        return '';
      }
    },

    async getNoteSections(noteHandle) {
      const content = await this.getNoteContent(noteHandle);
      return _parseHeadingsFromMarkdown(content);
    },

    async findNote(params = {}) {
      try {
        const qs = params.uuid
          ? `uuid=${encodeURIComponent(params.uuid)}`
          : `name=${encodeURIComponent(params.name)}`;
        const res = await fetch(`/api/note-find?${qs}`);
        const data = await res.json();
        return data?.uuid ? data : null;
      } catch {
        return null;
      }
    },

    async filterNotes(options = {}) {
      if (options.query) {
        try {
          const res = await fetch(`/api/note-find?name=${encodeURIComponent(options.query)}`);
          const data = await res.json();
          return data?.uuid ? [data] : [];
        } catch {
          return [];
        }
      }
      return [];
    },

    async createNote(name, tags = []) {
      try {
        const res = await fetch('/api/note-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, tags }),
        });
        const data = await res.json();
        return data.uuid;
      } catch {
        return null;
      }
    },

    async replaceNoteContent(noteHandle, content, options = {}) {
      const uuid = _resolveUUID(noteHandle);
      try {
        const payload = { uuid, content };
        if (options.section) payload.section = options.section;
        const res = await fetch('/api/note-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        return data.ok || false;
      } catch {
        return false;
      }
    },

    async insertNoteContent(noteHandle, content, options = {}) {
      const uuid = _resolveUUID(noteHandle);
      try {
        await fetch('/api/note-append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid, content, atEnd: !!options.atEnd }),
        });
      } catch {
        // silent failure in dev
      }
    },

    // ------------------------------------------------------------------
    // Media (app.attachNoteMedia is the real Amplenote API)
    // ------------------------------------------------------------------
    // [Claude] Task: add logIfEnabled logging for background image upload in dev mode
    // Prompt: "Add logIfEnabled logging for upload of background image to plugin"
    // Date: 2026-03-24 | Model: claude-4.6-opus-high-thinking
    async attachNoteMedia(_noteHandle, dataURL) {
      logIfEnabled('[dev-app] attachNoteMedia called, dataURL length:', dataURL?.length || 0);
      try {
        const res = await fetch("/api/attach-media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataURL }),
        });
        const result = await res.json();
        const url = result.url || null;
        logIfEnabled('[dev-app] attachNoteMedia response:', url ? `URL received: ${url}` : 'no URL in response');
        return url;
      } catch (err) {
        logIfEnabled('[dev-app] attachNoteMedia FAILED:', err);
        return null;
      }
    },

    async prompt(message, options = {}) {
      return _showSimplePromptModal(message, options);
    },

  };

  return _instance;
}
