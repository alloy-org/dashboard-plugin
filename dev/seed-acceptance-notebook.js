// Create repeatable synthetic notebook content alongside a preserved copy of the existing development notebook.
import crypto from "crypto";
import fs from "fs";
import path from "path";

const projectNames = ["Close open architecture decisions", "Safely retire deprecated auth and payment systems",
  "Protect three screen-free evenings each week", "Automate recurring codebase hygiene", "Improve dashboard load performance",
  "Ship accessible calendar navigation", "Build a production safety pin", "Document reliable onboarding"];

// ----------------------------------------------------------------------------------------------
// @desc Derive stable valid UUIDs so every acceptance copy starts with the same note and task identities.
// @param {string} label - Synthetic record key.
// @returns {string} Deterministic UUID.
function identityFromLabel(label) {
  const digest = crypto.createHash("sha256").update(label).digest("hex");
  return `${ digest.slice(0, 8) }-${ digest.slice(8, 12) }-4${ digest.slice(13, 16) }-a${ digest.slice(17, 20) }-${ digest.slice(20, 32) }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Generate notes and tasks with old edits, completions, dismissed work, scheduled work, and full Rich Footnotes.
// @param {string} directory - Isolated notebook directory containing a copied baseline.
// @returns {object} Generated content counts.
export function seedAcceptanceNotebook(directory) {
  const tasks = [];
  const domainNotes = { "domain-work-uuid": [], "domain-personal-uuid": [], "domain-side-uuid": [] };
  const now = Math.floor(Date.now() / 1000);
  for (let noteIndex = 0; noteIndex < 90; noteIndex += 1) {
    const domain = ["work", "personal", "side-projects"][Math.floor(noteIndex / 30)];
    const domainUuid = ["domain-work-uuid", "domain-personal-uuid", "domain-side-uuid"][Math.floor(noteIndex / 30)];
    const project = projectNames[noteIndex % projectNames.length];
    const uuid = identityFromLabel(`acceptance-note-${ noteIndex }`);
    domainNotes[domainUuid].push(uuid);
    const noteTasks = [];
    for (let taskIndex = 0; taskIndex < 8; taskIndex += 1) {
      const completedAt = taskIndex === 6 ? now - (noteIndex % 14 + 1) * 86400 : null;
      const content = `${ ["Investigate", "Implement", "Review", "Measure", "Document", "Validate", "Complete", "Revisit"][taskIndex] } ${ project.toLowerCase() }: milestone ${ noteIndex + 1 }`;
      const task = { completedAt, content, createdAt: now - (90 + noteIndex) * 86400, deadline: taskIndex === 3 ? now + 7 * 86400 : null,
        dismissedAt: taskIndex === 7 ? now - 86400 : null, important: taskIndex < 3, noteUUID: uuid,
        startAt: taskIndex === 4 ? now + (noteIndex % 5 + 1) * 86400 : null, updatedAt: now - noteIndex * 3600,
        urgent: taskIndex === 1, uuid: identityFromLabel(`acceptance-task-${ noteIndex }-${ taskIndex }`), victoryValue: 3 + taskIndex };
      tasks.push(task);
      noteTasks.push(`- [${ completedAt ? "x" : " " }] ${ content }`);
    }
    const evidence = `# ${ project }\n\nThis working note records milestone ${ noteIndex + 1 }, decisions, constraints, and outcomes.\n\n`
      + "## Decision log\n\nUse the [load budget][^budget] to judge progress. Preserve user-owned definitions and existing task decisions.\n\n"
      + "| Milestone | Target | Evidence |\n| --- | --- | --- |\n| First usable load | 900 ms | Compare warm and cold visits |\n\n"
      + `## Tasks\n\n${ noteTasks.join("\n") }\n\n[^budget]: [Load budget]()\n\n`
      + "    Measure navigation, first usable content, widget admission, and committed output separately.\n\n"
      + "    ```json\n    {\"targetMilliseconds\":900,\"preserveDecisions\":true}\n    ```\n\n"
      + "    A failed provider call must leave prior output readable and allow later recovery.\n";
    writeNote(directory, { content: evidence, tags: [domain, "acceptance/notebook"], title: `Acceptance ${ domain } working note ${ noteIndex + 1 }`, uuid });
  }
  const existingPath = path.join(directory, ".task-data.json");
  const existing = fs.existsSync(existingPath) ? JSON.parse(fs.readFileSync(existingPath, "utf8")) : { domainNotes: {}, tasks: [] };
  for (const [domainUuid, identities] of Object.entries(domainNotes)) {
    existing.domainNotes[domainUuid] = [...new Set([...(existing.domainNotes[domainUuid] || []), ...identities])];
  }
  const existingUuids = new Set(existing.tasks.map(task => task.uuid));
  existing.tasks.push(...tasks.filter(task => !existingUuids.has(task.uuid)));
  fs.writeFileSync(existingPath, JSON.stringify(existing, null, 2));
  return { generatedNotes: 90, generatedTasks: tasks.length, projectThemes: projectNames.length };
}

// ----------------------------------------------------------------------------------------------
// @desc Write a synthetic markdown note with the frontmatter understood by the existing development app.
// @param {string} directory - Destination directory.
// @param {object} note - Content, tags, title, and deterministic UUID.
// @returns {void}
function writeNote(directory, { content, tags, title, uuid }) {
  const timestamp = "2026-10-06T12:00:00.000Z";
  const frontmatter = `---\ntitle: ${ title }\nuuid: ${ uuid }\nversion: 1\ncreated: '${ timestamp }'\nupdated: '${ timestamp }'\narchived: false\ntags:\n`;
  fs.writeFileSync(path.join(directory, `${ uuid }.md`), `${ frontmatter }${ tags.map(tag => `  - ${ tag }`).join("\n") }\n---\n${ content }`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Pass an isolated notebook directory copied from notes/");
  console.log(JSON.stringify(seedAcceptanceNotebook(directory)));
}
