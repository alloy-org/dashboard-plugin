// Quarter Retrospective container: it always opens on the options screen, which offers the AI-written styles only with
// an AI or a saved story, generates the chosen style with its soundtrack vibe, and plays a saved story without
// generating again; the header links open the plan note and return to the options. Where Web Audio exists, the story
// plays its soundtrack from the click that started it, with a header button that mutes it and remembers the choice.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { FakeAudioContext } from "./fake-audio-context";
import { maintenanceApp } from "./project-maintenance-test-app";

const { default: QuarterRetrospective } = await import("dashboard/quarter-retrospective/quarter-retrospective");
const { generateRetrospective } = await import("dashboard/quarter-retrospective/retrospective-generation");
const { SETTING_KEYS } = await import("constants/settings");
const { pluginSettings, setPluginData } = await import("plugin-data");

const PLAN = { label: "Q3 2026", noteUUID: "q3-plan-note", quarter: 3, year: 2026 };
let mounted = null;

// ----------------------------------------------------------------------------------------------
// @desc An app holding notes by name, with one completed task in Q3 2026.
// @returns {object} App mock.
function retrospectiveApp() {
  const app = maintenanceApp({ tasks: [] });
  const completedAt = Math.floor(new Date(2026, 7, 12, 15).getTime() / 1000);
  app.getCompletedTasks = jest.fn(async () => [{ completedAt, content: "Ship the dashboard", uuid: "task-1", victoryValue: 5 }]);
  app.navigate = jest.fn(async () => true);
  return app;
}

// ----------------------------------------------------------------------------------------------
// @desc Flush the promise chains loading and generating queue.
async function settle() {
  for (let iteration = 0; iteration < 30; iteration += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Mount the retrospective for Q3 2026 in the Work domain.
// @param {object} app - App mock.
// @param {Function} [onClose] - Close handler.
// @returns {Promise<void>}
async function renderRetrospective(app, onClose = jest.fn()) {
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  await act(async () => {
    root.render(createElement(QuarterRetrospective, { app, domainName: "Work", domainUuid: "work-domain", onClose, plan: PLAN }));
  });
  await settle();
  mounted = { mountPoint, root };
}

// ----------------------------------------------------------------------------------------------
// @desc Click an element and let what it starts settle.
// @param {HTMLElement} element - The element.
async function clickAndSettle(element) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
}

// ----------------------------------------------------------------------------------------------
// @desc The header link with the given text.
// @param {string} text - Link text.
// @returns {HTMLElement|undefined} The link.
function headerLink(text) {
  return [...document.body.querySelectorAll(".retrospective-header-link")].find(link => link.textContent === text);
}

afterEach(async () => {
  delete window.AudioContext;
  FakeAudioContext.instances = [];
  setPluginData({ settings: {} });
  if (!mounted) return;
  await act(async () => { mounted.root.unmount(); });
  mounted.mountPoint.remove();
  mounted = null;
});

describe("QuarterRetrospective", () => {
  const styleCards = () => [...document.body.querySelectorAll(".retrospective-style-card")];
  const vibeCards = () => [...document.body.querySelectorAll(".retrospective-vibe-card")];
  const titles = elements => elements.map(card => card.querySelector(".retrospective-choice-card-title").textContent);
  const notes = elements => elements.map(card => card.querySelector(".retrospective-choice-card-note")?.textContent || null);
  const checked = elements => elements.map(card => card.getAttribute("aria-checked"));
  const primaryButton = () => document.body.querySelector(".retrospective-options-primary");

  it("without an AI, offers only Data, generates it with the chosen vibe, and opens on the options again", async () => {
    const app = retrospectiveApp();
    await renderRetrospective(app);
    expect(titles(styleCards())).toEqual(["Data", "Roast", "Spotify"]);
    expect(styleCards().map(card => card.disabled)).toEqual([false, true, true]);
    expect(notes(styleCards())).toEqual([null, "Needs an AI provider (Dashboard Settings)", "Needs an AI provider (Dashboard Settings)"]);
    expect(checked(styleCards())).toEqual(["true", "false", "false"]);
    expect(titles(vibeCards())).toEqual(["🌙 Chill", "🌆 Synth", "🏆 Anthem"]);
    expect(checked(vibeCards())).toEqual(["true", "false", "false"]);

    await clickAndSettle(vibeCards()[2]);
    expect(checked(vibeCards())).toEqual(["false", "false", "true"]);
    expect(document.body.querySelector(".retrospective-story")).toBeNull();
    expect(primaryButton().textContent).toBe("Generate Data retrospective");
    await clickAndSettle(primaryButton());
    expect(document.body.querySelector(".retrospective-story")).not.toBeNull();
    expect(app.noteContent("Work Q3 2026 Data Retrospective Data")).toContain('"soundtrackVibe":"anthem"');
    expect(headerLink("Options")).toBeDefined();

    await act(async () => { mounted.root.unmount(); });
    mounted.mountPoint.remove();
    mounted = null;
    await renderRetrospective(app);
    expect(document.body.querySelector(".retrospective-story")).toBeNull();
    expect(notes(styleCards())[0]).toMatch(/^Saved /);
    expect(primaryButton().textContent).toBe("Play Data retrospective");
    expect(document.body.querySelector(".retrospective-options-secondary").textContent).toBe("Generate a new Data one");
    await clickAndSettle(primaryButton());
    expect(document.body.querySelector(".retrospective-story")).not.toBeNull();
    // One generation reads the quarter and the quarter before it; playing the saved story reads neither again.
    expect(app.getCompletedTasks).toHaveBeenCalledTimes(2);

    await clickAndSettle(headerLink("Options"));
    expect(document.body.querySelector(".retrospective-options")).not.toBeNull();
  });

  it("chooses Spotify first when an AI is available", async () => {
    const app = retrospectiveApp();
    app.callLLM = jest.fn(async () => 25);
    await renderRetrospective(app);
    expect(styleCards().map(card => card.disabled)).toEqual([false, false, false]);
    expect(checked(styleCards())).toEqual(["false", "false", "true"]);
    expect(primaryButton().textContent).toBe("Generate Spotify retrospective");
  });

  it("lets a saved Spotify story play without an AI, but not be generated again", async () => {
    const app = retrospectiveApp();
    const request = { domainName: "Work", domainUuid: "work-domain", options: {}, quarter: 3, style: "spotify", year: 2026 };
    await generateRetrospective(app, request, { requestPrompt: async () => null });
    await renderRetrospective(app);
    expect(styleCards().map(card => card.disabled)).toEqual([false, true, false]);
    expect(checked(styleCards())).toEqual(["false", "false", "true"]);
    expect(primaryButton().textContent).toBe("Play Spotify retrospective");
    expect(document.body.querySelector(".retrospective-options-secondary")).toBeNull();
    await clickAndSettle(primaryButton());
    expect(document.body.querySelector(".retrospective-story")).not.toBeNull();
  });

  it("offers to generate again, not play, a saved story told from no completed tasks", async () => {
    const app = retrospectiveApp();
    const completedTasks = await app.getCompletedTasks();
    app.getCompletedTasks.mockImplementation(async () => []);
    await generateRetrospective(app, { domainName: "Work", domainUuid: "work-domain", options: {}, quarter: 3, style: "data", year: 2026 });
    app.getCompletedTasks.mockImplementation(async () => completedTasks);
    await renderRetrospective(app);
    expect(notes(styleCards())[0]).toMatch(/^Saved .+, with no tasks$/);
    expect(primaryButton().textContent).toBe("Generate a new Data retrospective");
    expect(document.body.querySelector(".retrospective-options-secondary")).toBeNull();
    await clickAndSettle(primaryButton());
    expect(app.noteContent("Work Q3 2026 Data Retrospective Data")).toContain('"totalTaskCount":1');
  });

  it("plays the chosen vibe from the click that started the story, and remembers a mute", async () => {
    window.AudioContext = FakeAudioContext;
    const app = retrospectiveApp();
    app.setSetting = jest.fn(async () => true);
    await renderRetrospective(app);
    expect(FakeAudioContext.instances).toHaveLength(0);
    await clickAndSettle(vibeCards()[1]);
    await clickAndSettle(primaryButton());
    expect(FakeAudioContext.instances).toHaveLength(1);
    const audioContext = FakeAudioContext.instances[0];
    expect(audioContext.state).toBe("running");
    expect(audioContext.startedSources.length).toBeGreaterThan(0);

    const soundButton = () => document.body.querySelector(".retrospective-header-sound");
    expect(soundButton().textContent).toBe("🔊 Sound on");
    await clickAndSettle(soundButton());
    expect(soundButton().textContent).toBe("🔇 Sound off");
    expect(app.setSetting).toHaveBeenCalledWith(SETTING_KEYS.RETROSPECTIVE_SOUNDTRACK_MUTED, "true");
    expect(pluginSettings()[SETTING_KEYS.RETROSPECTIVE_SOUNDTRACK_MUTED]).toBe("true");

    await clickAndSettle(headerLink("Options"));
    expect(soundButton()).toBeNull();
    await clickAndSettle(primaryButton());
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(soundButton().textContent).toBe("🔇 Sound off");
  });

  it("shows no sound button where Web Audio is missing", async () => {
    await renderRetrospective(retrospectiveApp());
    await clickAndSettle(primaryButton());
    expect(document.body.querySelector(".retrospective-story")).not.toBeNull();
    expect(document.body.querySelector(".retrospective-header-sound")).toBeNull();
  });

  it("opens the plan note from the header and closes the retrospective", async () => {
    const app = retrospectiveApp();
    const onClose = jest.fn();
    await renderRetrospective(app, onClose);
    await clickAndSettle(headerLink("Open plan note"));
    expect(onClose).toHaveBeenCalled();
    expect(app.navigate).toHaveBeenCalled();
  });
});
