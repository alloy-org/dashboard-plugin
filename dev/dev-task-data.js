// Persist API-created tasks and explicit Task Domain membership across development server requests.
import fs from "fs";
import path from "path";

// ----------------------------------------------------------------------------------------------
// @desc Read task identities and domain membership separately from human-readable note markdown.
// @param {string} notesDir - Development notes directory.
// @returns {object} Stored domain note UUIDs and tasks, or empty data on first use.
export function readTaskData(notesDir) {
  const filePath = path.join(notesDir, ".task-data.json");
  if (!fs.existsSync(filePath)) return { domainNotes: {}, tasks: [] };
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// ----------------------------------------------------------------------------------------------
// @desc Save development task data synchronously so subsequent API requests see the completed write.
// @param {object} data - Domain membership and task records.
// @param {string} notesDir - Development notes directory.
// @returns {void}
export function writeTaskData(data, notesDir) {
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(path.join(notesDir, ".task-data.json"), JSON.stringify(data, null, 2), "utf-8");
}
