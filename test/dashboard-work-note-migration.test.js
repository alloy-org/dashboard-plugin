// Ensure queue layout migration preserves prose and Rich Footnotes outside the legacy JSON payload.
import { workQueueNotesApp } from "./work-queue-test-notes";
import { workQueueBucketIndex, workQueueNotePayload } from "dashboard/work-queue/dashboard-work-note";
import DashboardWorkRepository, { workQueueNoteName } from "dashboard/work-queue/dashboard-work-repository";

// ----------------------------------------------------------------------------------------------
// @desc Migrate a queue carrying multiline footnotes, then update its final bucket without deleting the definitions.
// @returns {Promise<void>}
async function verifyAnnotationPreservation() {
  const scope = "work:Q4 2026";
  const app = workQueueNotesApp();
  const noteUuid = await app.createNote(workQueueNoteName(scope), [], { archive: true });
  const preamble = "# Dashboard work queue\n\nSee the [operator guide][^guide] before changing queue data.\n\n";
  const definitions = "\n[^guide]: [Operator guide]()\n\n    Preserve the full paragraph and the following code example.\n\n"
    + "    ```json\n    {\"preserve\":true}\n    ```\n\n    Additional context after the code.\n";
  app.notes.get(noteUuid).content = `${ preamble }\`\`\`json\n{\"jobs\":[],\"schemaVersion\":1,\"scopeKey\":\"${ scope }\"}\n\`\`\`\n${ definitions }`;
  const keys = Array.from({ length: 100 }, (unused, index) => `rank:project-${ index }`);
  const finalBucketKey = keys.find(key => workQueueBucketIndex(key) === 15);
  const repository = new DashboardWorkRepository({ app, clock: () => 1000 });
  await repository.saveJob(scope, { key: finalBucketKey, type: "rank" });
  const migrated = app.noteContent(workQueueNoteName(scope));
  expect(migrated.startsWith(preamble)).toBe(true);
  expect(migrated).toContain(definitions);
  expect(migrated.indexOf("# Queue annotations")).toBeGreaterThan(migrated.indexOf("## Queue bucket 16"));
  await repository.claim(scope, finalBucketKey, { ownerId: "me", token: "me:1" });
  const updated = app.noteContent(workQueueNoteName(scope));
  expect(updated).toContain(definitions);
  expect(workQueueNotePayload(updated).payload.jobs[0].attemptToken).toBe("me:1");
}

it("preserves annotations and full Rich Footnotes across migration and final-bucket writes", verifyAnnotationPreservation);
