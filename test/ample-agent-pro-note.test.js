// Every feature that treats Ample Agent Pro as an LLM source asks findAmpleAgentProNote. A missing note, a
// thrown lookup, and an app that cannot search notes are the same answer: not installed.

import { jest } from "@jest/globals";

const { AMPLE_AGENT_PRO_NOTE_NAME, findAmpleAgentProNote } = await import("providers/ai-provider-settings");

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
});
