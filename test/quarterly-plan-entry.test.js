// The Planning splash is chosen from how many tasks are counted, and whether Agent Pro or a key that can
// actually answer is available. A saved key is probed with a one-word status check. With no Task Domain, the
// All Notes scan skips notes tagged starter-notes from the tags on each note handle.

import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { setPluginData } from "plugin-data";

const llmPrompt = jest.fn();
await jest.unstable_mockModule("providers/fetch-ai-provider", () => ({
  llmPrompt: (...args) => llmPrompt(...args),
}));

const { resolveQuarterlyPlanEntry } = await import("quarterly-plan-service");
const { AMPLE_AGENT_PRO_NOTE_NAME, AMPLE_AGENT_PRO_URL } = await import("providers/ai-provider-settings");

const DOMAIN_UUID = "domain-work";

// ----------------------------------------------------------------------------------------------
// @desc Build the requested number of tasks, all living in one note.
// @param {number} count - How many tasks
// @param {string} noteUUID - Note they belong to
// @returns {Array<Object>} Tasks
function tasksOnNote(count, noteUUID) {
  return Array.from({ length: count }, (_, index) => ({ noteUUID, uuid: `${ noteUUID }-${ index }` }));
}

// ----------------------------------------------------------------------------------------------
// @desc An app whose domain tasks are under the test's control.
// @param {Object} params - { agentPro, tasks }
// @returns {Object} The app stub
function entryApp({ agentPro = false, tasks = [] } = {}) {
  return {
    findNote: jest.fn(async ({ name } = {}) => (agentPro && name === AMPLE_AGENT_PRO_NOTE_NAME ? { name, uuid: "agent-pro" } : null)),
    getTaskDomainTasks: jest.fn(async () => tasks),
  };
}

// ----------------------------------------------------------------------------------------------
// @desc An app with no Task Domain, whose task-list notes and their tasks are under the test's control.
// @param {Array<Object>} notes - Note handles, each with an optional tasks array
// @returns {Object} The app stub
function allNotesApp(notes) {
  return {
    filterNotes: jest.fn(async () => notes),
    findNote: jest.fn(async () => null),
    getNoteTasks: jest.fn(async handle => notes.find(note => note.uuid === handle.uuid)?.tasks || []),
  };
}

describe("resolveQuarterlyPlanEntry", () => {
  beforeEach(() => {
    llmPrompt.mockReset();
    setPluginData({ context: {}, settings: {} });
  });

  it("asks for an import when fewer than 25 tasks sit outside starter notes", async () => {
    const notes = [
      { name: "Real work", tags: ["work"], tasks: tasksOnNote(7, "real-note"), uuid: "real-note" },
      { name: "Welcome", tags: ["starter-notes"], tasks: tasksOnNote(40, "starter-note"), uuid: "starter-note" },
      { name: "Welcome tour", tags: ["starter-notes/welcome"], tasks: tasksOnNote(3, "nested-note"), uuid: "nested-note" },
    ];
    const app = allNotesApp(notes);

    const entry = await resolveQuarterlyPlanEntry(app, { domainUuid: null });

    expect(entry.kind).toBe("import");
    expect(entry.applicableTaskCount).toBe(7);
    expect(entry.importSources.map(source => source.label)).toEqual(["Evernote", "Obsidian", "Todoist", "Notion", "Markdown"]);
    expect(entry.importSources[0].url).toBe("https://www.amplenote.com/help/import_notes_and_tasks_overview#___import_from_evernote");
    expect(app.getNoteTasks).toHaveBeenCalledTimes(1);
    expect(app.getNoteTasks).toHaveBeenCalledWith({ uuid: "real-note" }, { includeDone: false });
    expect(app.filterNotes).toHaveBeenCalledTimes(1);
    expect(app.findNote).not.toHaveBeenCalled();
    expect(llmPrompt).not.toHaveBeenCalled();
  });

  it("treats 25 applicable tasks as enough to leave the import splash", async () => {
    const app = entryApp({ tasks: tasksOnNote(25, "real-note") });

    const entry = await resolveQuarterlyPlanEntry(app, { domainUuid: DOMAIN_UUID });

    expect(entry.kind).toBe("needs-ai");
    expect(entry.applicableTaskCount).toBe(25);
    expect(entry.agentProUrl).toBe(AMPLE_AGENT_PRO_URL);
  });

  it("invites a plan when Ample Agent Pro is installed and no key is saved", async () => {
    const app = entryApp({ agentPro: true, tasks: tasksOnNote(30, "real-note") });

    const entry = await resolveQuarterlyPlanEntry(app, { domainUuid: DOMAIN_UUID });

    expect(entry.kind).toBe("ready");
    expect(entry.videoEmbedUrl).toBe("https://www.youtube.com/embed/zyLI9KCziNU?start=5");
    expect(llmPrompt).not.toHaveBeenCalled();
  });

  it("probes a saved key with a one-word status check and invites a plan when it answers", async () => {
    setPluginData({ settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "sk-test-key", [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai" } });
    llmPrompt.mockResolvedValue("ok");
    const app = entryApp({ tasks: tasksOnNote(30, "real-note") });

    const entry = await resolveQuarterlyPlanEntry(app, { domainUuid: DOMAIN_UUID });

    expect(entry.kind).toBe("ready");
    const [calledApp, plugin, prompt, , apiKey, jsonResponse, timeoutSeconds] = llmPrompt.mock.calls[0];
    expect(calledApp).toBe(app);
    expect(plugin).toBeNull();
    expect(prompt).toBe('Reply with the JSON {"ok": true}.');
    expect(apiKey).toBe("sk-test-key");
    expect(jsonResponse).toBe(false);
    expect(timeoutSeconds).toBe(10);
  });

  it("stays on the AI splash when the saved key fails to answer and Agent Pro is absent", async () => {
    setPluginData({ settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "sk-test-key", [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai" } });
    llmPrompt.mockRejectedValue(new Error("invalid key"));
    const app = entryApp({ tasks: tasksOnNote(30, "real-note") });

    const entry = await resolveQuarterlyPlanEntry(app, { domainUuid: DOMAIN_UUID });

    expect(entry.kind).toBe("needs-ai");
  });

  it("still invites a plan when the key fails but Ample Agent Pro is installed", async () => {
    setPluginData({ settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: "sk-test-key" } });
    llmPrompt.mockResolvedValue("  ");
    const app = entryApp({ agentPro: true, tasks: tasksOnNote(30, "real-note") });

    const entry = await resolveQuarterlyPlanEntry(app, { domainUuid: DOMAIN_UUID });

    expect(entry.kind).toBe("ready");
  });

  it("falls back to the import splash when task lookup fails", async () => {
    const app = entryApp();
    app.getTaskDomainTasks.mockRejectedValue(new Error("offline"));

    const entry = await resolveQuarterlyPlanEntry(app, { domainUuid: DOMAIN_UUID });

    expect(entry).toMatchObject({ applicableTaskCount: 0, kind: "import" });
  });
});
