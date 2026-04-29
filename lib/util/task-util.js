// =============================================================================
// [GPT-5.5-authored file]
// Prompt summary: "move DreamTask completion into a general task completion utility"
// =============================================================================

const DAILY_JOTS_TAG = "daily-jots";

// ----------------------------------------------------------------------------------------------
// @desc Build markdown for an already-completed Amplenote task with task metadata in an HTML comment.
// @param {number} completedAt - Unix timestamp in seconds.
// @param {object} task - Task-like object with optional title/content.
// [Claude GPT-5.5] Task: format completed task markdown for insertNoteContent
// Prompt: "rebrand completeDreamTask as a general purpose way to mark a task complete"
function completedTaskMarkdownFromTask(completedAt, task) {
  const title = String(task?.title || task?.content || "Untitled task").replace(/\s+/g, " ").trim();
  return `\n- [x] ${ title } <!-- ${ JSON.stringify({ completedAt }) } -->\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc Find or create today's Daily Jot note and return its UUID.
// @param {object} app - Amplenote app bridge.
// [Claude GPT-5.5] Task: resolve daily jot target for completed inserted tasks
// Prompt: "look for a note with today's name and create such a note, with the daily-jots tag"
export async function dailyJotNoteUuidFromToday(app) {
  const noteName = todayDailyJotNoteName();
  const existingNote = await app.findNote({ name: noteName, tags: [DAILY_JOTS_TAG] });
  if (existingNote?.uuid) return existingNote.uuid;
  return app.createNote(noteName, [DAILY_JOTS_TAG]);
}

// ----------------------------------------------------------------------------------------------
// @desc Mark an existing task complete, or insert completed task markdown into a note when no task UUID exists.
// @param {object} app - Amplenote app bridge.
// @param {string|null} noteUUID - Note UUID used for inserting a completed task when `task.uuid` is absent.
// @param {object} task - Task-like object with optional uuid/title/content.
// @returns {Promise<number|false>} Completed-at timestamp in Unix seconds, or false when no task/note target exists.
// [Claude GPT-5.5] Task: provide general task completion helper using app.updateTask or insertNoteContent
// Prompt: "move completeDreamTask to util/task-util.js and rebrand it as general purpose"
export async function markTaskComplete(app, noteUUID, task) {
  if (!task) return false;
  const completedAt = Math.floor(Date.now() / 1000);
  if (task.uuid) {
    await app.updateTask(task.uuid, { completedAt });
  } else if (noteUUID) {
    await app.insertNoteContent({ uuid: noteUUID }, completedTaskMarkdownFromTask(completedAt, task), { atEnd: true });
  } else {
    return false;
  }
  return completedAt;
}

// ----------------------------------------------------------------------------------------------
// @desc Return the English ordinal suffix for a day of month.
// @param {number} dayOfMonth - Calendar day number.
// [Claude GPT-5.5] Task: format daily jot note names with ordinal day suffixes
// Prompt: "look for a note with today's name, e.g., April 29th, 2026"
function ordinalSuffixFromDay(dayOfMonth) {
  const tens = dayOfMonth % 100;
  if (tens >= 11 && tens <= 13) return "th";
  switch (dayOfMonth % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Today's Daily Jot note name, e.g. "April 29th, 2026".
// [Claude GPT-5.5] Task: derive today's daily jot note name for inserted completed tasks
// Prompt: "look for a note with today's name, e.g., April 29th, 2026"
function todayDailyJotNoteName() {
  const today = new Date();
  const month = today.toLocaleString([], { month: "long" });
  const day = today.getDate();
  const year = today.getFullYear();
  return `${ month } ${ day }${ ordinalSuffixFromDay(day) }, ${ year }`;
}
