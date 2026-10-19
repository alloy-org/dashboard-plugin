import DashboardSettingNote from "dashboard/dashboard-setting-note";

// ------------------------------------------------------------------------------------------
// @desc An app holding one existing settings note in memory.
// @param {string} content - The note's starting content.
// @returns {Object} App with the note methods DashboardSettingNote calls, and the note for inspection.
function appWithSettingNote(content) {
  const note = { content, uuid: "setting-note" };
  return {
    findNote: async () => ({ uuid: note.uuid }),
    getNoteContent: async () => note.content,
    note,
    replaceNoteContent: async (_handle, newContent) => { note.content = newContent; },
  };
}

describe("DashboardSettingNote", () => {
  it("leaves the banner image unset until the user picks one", async () => {
    const settings = await new DashboardSettingNote(appWithSettingNote("Time format: 24h\nWeek format: monday")).load();
    expect(settings).toEqual({ timeFormat: "24h", weekFormat: "monday" });
  });

  it("saves the banner image beside the formats and reads it back", async () => {
    const app = appWithSettingNote("Time format: 24h\nWeek format: monday");
    const settingNote = new DashboardSettingNote(app);
    await settingNote.load();
    await settingNote.save({ bannerImage: "aurora" });
    expect(app.note.content).toBe("Banner image: aurora\nTime format: 24h\nWeek format: monday");
    expect((await new DashboardSettingNote(app).load()).bannerImage).toBe("aurora");
  });
});
