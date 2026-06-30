import { IS_DEV_ENVIRONMENT } from "constants/settings";

// [Claude] Task: navigate via app.navigate (real API) instead of non-API app.navigateToNote
// Prompt: "non-API methods on app should be standalone functions"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export async function navigateToNote(app, noteUUID) {
  if (IS_DEV_ENVIRONMENT) {
    return { devEdit: true, noteUUID };
  }
  return await app.navigate(`https://www.amplenote.com/notes/${noteUUID}`);
}

export async function fetchNoteContent(app, noteUUID) {
  return await app.getNoteContent({ uuid: noteUUID });
}

export async function saveNoteContent(app, noteUUID, content, options) {
  return await app.replaceNoteContent({ uuid: noteUUID }, content, options);
}
