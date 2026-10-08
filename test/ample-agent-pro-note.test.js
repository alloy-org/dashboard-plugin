// Every feature that treats Ample Agent Pro as an LLM source asks findAmpleAgentProNote. A missing note, a
// thrown lookup, and an app that cannot search notes are the same answer: not installed. A miss refreshes the
// notes list and searches again, and a found note is remembered so a later miss cannot show a subscriber the upsell.

import { jest } from "@jest/globals";

const { AMPLE_AGENT_PRO_NOTE_NAME, findAmpleAgentProNote, isAmpleAgentProInstalled, recordAmpleAgentProResponded } =
  await import("providers/ai-provider-settings");

describe("findAmpleAgentProNote", () => {
  it("returns the note when Ample Agent Pro is installed", async () => {
    const note = { name: AMPLE_AGENT_PRO_NOTE_NAME, uuid: "agent-pro" };
    const app = { findNote: jest.fn(async () => note) };

    await expect(findAmpleAgentProNote(app)).resolves.toBe(note);
    expect(app.findNote).toHaveBeenCalledWith({ name: AMPLE_AGENT_PRO_NOTE_NAME });
  });

  it("returns null when the note is missing", async () => {
    const app = { findNote: jest.fn(async () => null) };

    await expect(findAmpleAgentProNote(app)).resolves.toBeNull();
  });

  it("returns null when the lookup throws", async () => {
    const app = { findNote: jest.fn(async () => { throw new Error("offline"); }) };

    await expect(findAmpleAgentProNote(app)).resolves.toBeNull();
  });

  it("returns null when the app cannot search notes", async () => {
    await expect(findAmpleAgentProNote({})).resolves.toBeNull();
  });

  it("refreshes the notes list and searches again when the first search misses", async () => {
    const note = { name: AMPLE_AGENT_PRO_NOTE_NAME, uuid: "agent-pro" };
    const app = { context: { refreshNotesList: jest.fn(async () => true) },
      findNote: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(note) };

    await expect(findAmpleAgentProNote(app)).resolves.toBe(note);
    expect(app.context.refreshNotesList).toHaveBeenCalledTimes(1);
    expect(app.findNote).toHaveBeenCalledTimes(2);
  });

  it("keeps a found note when a later search misses", async () => {
    const note = { name: AMPLE_AGENT_PRO_NOTE_NAME, uuid: "agent-pro" };
    const app = { findNote: jest.fn().mockResolvedValueOnce(note).mockResolvedValue(null) };

    await findAmpleAgentProNote(app);

    await expect(findAmpleAgentProNote(app)).resolves.toBe(note);
    expect(app.findNote).toHaveBeenCalledTimes(1);
  });

  it("shares one lookup between concurrent callers", async () => {
    const note = { name: AMPLE_AGENT_PRO_NOTE_NAME, uuid: "agent-pro" };
    const app = { findNote: jest.fn(async () => note) };

    const [first, second] = await Promise.all([findAmpleAgentProNote(app), findAmpleAgentProNote(app)]);

    expect(first).toBe(note);
    expect(second).toBe(note);
    expect(app.findNote).toHaveBeenCalledTimes(1);
  });

  it("does not treat the embed bridge's failure envelope as a note", async () => {
    const app = { findNote: jest.fn(async () => ({ embedCallFailed: true, error: "offline" })) };

    await expect(findAmpleAgentProNote(app)).resolves.toBeNull();
  });
});

describe("isAmpleAgentProInstalled", () => {
  it("reports installed once Agent Pro has answered a request, even when its note cannot be found", async () => {
    const app = { findNote: jest.fn(async () => null) };
    recordAmpleAgentProResponded(app);

    await expect(isAmpleAgentProInstalled(app)).resolves.toBe(true);
    expect(app.findNote).not.toHaveBeenCalled();
  });

  it("reports whether the note exists when Agent Pro has not answered yet", async () => {
    const installedApp = { findNote: jest.fn(async () => ({ uuid: "agent-pro" })) };
    const missingApp = { findNote: jest.fn(async () => null) };

    await expect(isAmpleAgentProInstalled(installedApp)).resolves.toBe(true);
    await expect(isAmpleAgentProInstalled(missingApp)).resolves.toBe(false);
  });
});
