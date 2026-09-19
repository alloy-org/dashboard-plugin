// Preserve source-note identities through agenda reads and expose development inspection with retry.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { GUIDE_METADATA_HEADING, guideSectionRange, initialVisionGuideMarkdown, intentSectionDefinition } from "plan-wizard/vision-guide-markdown";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { loadProjectProgress } from "project-progress-service";

const settings = await import("constants/settings");
await jest.unstable_mockModule("constants/settings", () => ({ ...settings, IS_DEV_ENVIRONMENT: true }));
const { default: ProposedAgendaMessage } = await import("proposed-agenda-message");
const scope = resolvePlanScope({ domainName: "Work", domainUuid: "work-domain", quarter: 3, year: 2026 });

// ----------------------------------------------------------------------------------------------
// @desc Both metadata and leaf JSON errors retain the precise guide UUID without writing over its content.
it.each(["metadata", "leaf"])("identifies the source of malformed guide %s", async section => {
  const note = { name: "Work Mission Builder Vision Guide 2026", uuid: "broken-guide" };
  const markdown = initialVisionGuideMarkdown(scope);
  const heading = section === "metadata" ? GUIDE_METADATA_HEADING : intentSectionDefinition("goals", scope).text;
  const range = guideSectionRange(markdown, heading);
  const content = `${ markdown.slice(0, range.bodyStart) }\n\`\`\`json\n{broken}\n\`\`\`\n${ markdown.slice(range.end) }`;
  const app = { filterNotes: jest.fn().mockResolvedValue([note]), findNote: jest.fn().mockResolvedValue(note),
    getNoteContent: jest.fn().mockResolvedValue(content) };
  await expect(readVisionGuide(app, scope)).rejects.toMatchObject({ noteUuid: note.uuid });
});

// ----------------------------------------------------------------------------------------------
// @desc Corrupt progress JSON names its source and stops before any replacement can overwrite user data.
it("identifies malformed progress notes and preserves their content", async () => {
  const note = { name: "Project Builder Q3 2026 Work Progress", uuid: "broken-progress" };
  const app = { filterNotes: jest.fn().mockResolvedValue([]), findNote: jest.fn().mockResolvedValue(note),
    getNoteContent: jest.fn().mockResolvedValue("# Project progress data\n\n```json\n{broken}\n```"), replaceNoteContent: jest.fn() };
  await expect(loadProjectProgress(app, { domainName: scope.domainName, domainUuid: scope.domainUuid,
    quarterlyContent: "", targetDate: new Date(2026, 8, 22) })).rejects.toMatchObject({ noteUuid: note.uuid });
  expect(app.replaceNoteContent).not.toHaveBeenCalled();
});

// ----------------------------------------------------------------------------------------------
// @desc Dev users can inspect full source markdown, return to the error, and retry without automatic writes.
it("opens the source note in the dev editor and keeps retry available", async () => {
  const app = { getNoteContent: jest.fn().mockResolvedValue("# Source note\n\n```json\n{broken}\n```"), replaceNoteContent: jest.fn() };
  const onRetry = jest.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(ProposedAgendaMessage, { app, message: "Invalid JSON",
      noteUuid: "broken-note", onRetry })));
    const link = container.querySelector("a");
    expect(link.textContent).toBe("View source note");
    expect(link.getAttribute("href")).toContain("broken-note");
    await act(async () => link.click());
    expect(app.getNoteContent).toHaveBeenCalledWith({ uuid: "broken-note" });
    expect(container.querySelector('[aria-label="Data note content"]').textContent).toContain("{broken}");
    expect(app.replaceNoteContent).not.toHaveBeenCalled();
    await act(async () => container.querySelector(".note-editor-btn--back").click());
    await act(async () => container.querySelector(".proposed-agenda-retry").click());
    expect(onRetry).toHaveBeenCalledTimes(1);
    await act(async () => root.render(createElement(ProposedAgendaMessage, { app, message: "Endpoint unavailable", onRetry })));
    expect(container.querySelector("a")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
