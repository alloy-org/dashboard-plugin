// Verify the dictionary's People section and the recent-task scan that fills it: people are read with the other names
// they answer to and matched by any of them, a person or term is merged where it belongs, deliberate "@" and "@@"
// mentions are found and the owner left out, the scan accepts only new proposals drawn from the tasks and always adds
// linked people, it reads only tasks added since its watermark, and a person's evidence leads with their own note and
// the tasks naming them, which the refinement prompt asks about in terms of who they are to the owner.
import { jest } from "@jest/globals";
import { createCollectTermEvidenceHandler } from "dashboard/work-queue/jobs/collect-term-evidence";
import { createDiscoverTaskTermsHandler } from "dashboard/work-queue/jobs/discover-task-terms";
import { dictionaryKeyFromEntry } from "plan-wizard/stack-rank/dictionary-people";
import { textContainsTerm } from "plan-wizard/stack-rank/dictionary-term-discovery";
import { storedTermEvidence } from "plan-wizard/stack-rank/dictionary-term-evidence-store";
import { termRefinementPrompt } from "plan-wizard/stack-rank/dictionary-term-refinement";
import { dueTermEvidence } from "plan-wizard/stack-rank/dictionary-term-schedule";
import { accountOwner, mentionedPeopleFromTasks, personMentionsFromMarkdown,
  readableTaskText } from "plan-wizard/stack-rank/person-mentions";
import { acceptedTaskTermEntries } from "plan-wizard/stack-rank/task-term-discovery";
import { readTaskTermScan, SCAN_INTERVAL_MILLISECONDS, taskTermScanDue,
  tasksForTermScan } from "plan-wizard/stack-rank/task-term-scan-store";
import { dictionaryEntriesFromContent, dictionaryNoteName, dictionaryObjectFromEntries,
  mergedDictionaryContent } from "plan-wizard/stack-rank/user-terms-dictionary";
import { jobContext, notebookApp, NOW } from "./project-maintenance-test-app";

const YEAR = 2026;
const PERSON_LINK = "[@Lucian Ruscanu](https://www.amplenote.com/notes/people/person-lucian)";
const NOTE_LINK = "[@Dana Whitfield](https://www.amplenote.com/notes/note-dana)";
const DICTIONARY = "Intro.\n\n# Terms\n- **Amplenote**: Notes app [builder]\n\n# People\n"
  + "- **Me** \\(also Bill Harding): The account owner.\n"
  + "- **Lucian Ruscanu** (also Lucian): Collaborator on video production. [builder]\n"
  + "- **Pat**: My accountant\n\n# Examined projects\n- Old project (examined 2026-09-01)\n";

// ----------------------------------------------------------------------------------------------
// @desc A task as the host returns it, created the given number of hours before NOW.
// @param {string} uuid - Task UUID.
// @param {string} content - Task markdown.
// @param {number} hoursAgo - Hours before NOW it was created.
// @param {string} [noteUUID="note-work"] - The note holding it.
// @returns {object} A task.
function task(uuid, content, hoursAgo, noteUUID = "note-work") {
  return { content, createdAt: new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000).toISOString(), noteUUID, uuid };
}

describe("dictionary people", () => {
  it("reads people with their other names, the owner by theirs, and keys each by every name", () => {
    const entries = dictionaryEntriesFromContent(DICTIONARY);
    const people = entries.filter(entry => entry.isPerson);
    expect(people.map(entry => [entry.term, entry.aliases, entry.isBuilderOwned])).toEqual([["Me", ["Bill Harding"], false],
      ["Lucian Ruscanu", ["Lucian"], true], ["Pat", [], false]]);
    expect(Object.keys(dictionaryObjectFromEntries(entries))).toEqual(["Amplenote", "Bill Harding", "Lucian Ruscanu / Lucian", "Pat"]);
    expect(textContainsTerm("Ask Lucian about the script", dictionaryKeyFromEntry(people[1]))).toBe(true);
    expect(textContainsTerm("Ask Lucianne about the script", dictionaryKeyFromEntry(people[1]))).toBe(false);
  });

  it("reads a note without a Terms heading only up to its People heading", () => {
    const entries = dictionaryEntriesFromContent("- **Amplenote**: Notes app\n\n# People\n- **Pat**: My accountant\n");
    expect(entries.map(entry => [entry.term, entry.isPerson])).toEqual([["Amplenote", false], ["Pat", true]]);
  });

  it("refines a person in place by any name, keeping their names, and appends new people and terms where they belong", () => {
    const merged = mergedDictionaryContent(DICTIONARY, { incomingEntries: [
      { aliases: ["Lucian R"], definition: "Frequent Amplenote collaborator on video scripts and A/B tests.", isPerson: true, term: "Lucian" },
      { aliases: [], definition: "Rewritten by the plugin", isPerson: true, term: "Pat" },
      { aliases: ["Dana"], definition: "Likely a client the owner onboards.", isPerson: true, term: "Dana Whitfield" },
      { definition: "Amplenote's weekly release email.", term: "Ship Notes" }] });
    expect(merged.refinedTerms).toEqual(["Lucian Ruscanu"]);
    expect(merged.addedTerms).toEqual(["Dana Whitfield", "Ship Notes"]);
    expect(merged.content).toContain("- **Lucian Ruscanu** (also Lucian, Lucian R): Frequent Amplenote collaborator on video scripts "
      + "and A/B tests. [builder]");
    expect(merged.content).toContain("- **Pat**: My accountant\n- **Dana Whitfield** (also Dana): Likely a client the owner onboards. [builder]\n");
    expect(merged.content).toContain("- **Amplenote**: Notes app [builder]\n- **Ship Notes**: Amplenote's weekly release email. [builder]\n");
  });

  it("creates the People heading above the examined projects when the note has none", () => {
    const content = "# Terms\n- **Amplenote**: Notes app\n\n# Examined projects\n- Old project (examined 2026-09-01)\n";
    const merged = mergedDictionaryContent(content, { incomingEntries: [{ aliases: [], definition: "Likely a client the owner onboards.",
      isPerson: true, term: "Dana" }] });
    expect(merged.content).toBe("# Terms\n- **Amplenote**: Notes app\n\n# People\n- **Dana**: Likely a client the owner onboards. [builder]\n\n"
      + "# Examined projects\n- Old project (examined 2026-09-01)\n");
  });
});

describe("person mentions", () => {
  it("finds person links, @ note links, and typed mentions, and flattens links for reading", () => {
    const markdown = `Review cut with ${ PERSON_LINK } and ${ NOTE_LINK }; see [Roadmap](https://www.amplenote.com/notes/roadmap) `
      + "then ping @Sam Lee";
    expect(personMentionsFromMarkdown(markdown)).toEqual([
      { name: "Lucian Ruscanu", noteUuid: null, personUuid: "person-lucian" },
      { name: "Dana Whitfield", noteUuid: "note-dana", personUuid: null },
      { name: "Sam Lee", noteUuid: null, personUuid: null }]);
    expect(readableTaskText(markdown)).toBe("Review cut with @Lucian Ruscanu and @Dana Whitfield; see Roadmap then ping @Sam Lee");
  });

  it("leaves the owner out by name or UUID", () => {
    const tasks = [task("t1", `Sync with ${ PERSON_LINK }`, 1), task("t2", "Ask @Bill Harding", 1),
      task("t3", "[@Me](https://www.amplenote.com/notes/people/owner-uuid) to review", 1)];
    const people = mentionedPeopleFromTasks(tasks, { owner: { names: ["Bill Harding"], uuid: "owner-uuid" } });
    expect(people).toEqual([{ name: "Lucian Ruscanu", noteUuids: [], personUuids: ["person-lucian"], taskUuids: ["t1"] }]);
  });

  it("names the owner from the host first, then the dictionary, and tolerates a host without the method", async () => {
    const entries = dictionaryEntriesFromContent(DICTIONARY);
    const hostApp = { getCurrentPerson: jest.fn(async () => ({ name: "William Harding", uuid: "owner-uuid" })) };
    expect(await accountOwner(hostApp, entries)).toEqual({ names: ["William Harding", "Bill Harding"], uuid: "owner-uuid" });
    expect(await accountOwner({}, entries)).toEqual({ names: ["Bill Harding"], uuid: null });
    const failingApp = { getCurrentPerson: async () => { throw new Error("Unknown method"); } };
    expect(await accountOwner(failingApp, [])).toEqual({ names: [], uuid: null });
  });
});

describe("recent-task term scan", () => {
  const tasks = [task("t1", `Draft video script with ${ PERSON_LINK }`, 2), task("t2", `Onboarding call prep for ${ NOTE_LINK }`, 3),
    task("t3", "Ask Priya about the Ship Notes copy", 4)];

  it("accepts only new proposals drawn from the tasks, and adds linked people the provider left out", () => {
    const response = { people: [
      { aliases: ["Lucian"], definition: "A collaborator already defined in the dictionary.", name: "Lucian Ruscanu" },
      { aliases: [], definition: "The account owner, who writes these tasks.", name: "Bill Harding" },
      { aliases: [], definition: "Likely a copywriter collaborating on Ship Notes.", name: "Priya" },
      { aliases: [], definition: "Someone the tasks never mention at all.", name: "Quentin" }],
    terms: [{ definition: "Amplenote's weekly release email.", term: "Ship Notes" }, { definition: "Defined already in this note.",
      term: "Amplenote" }] };
    const entries = acceptedTaskTermEntries(response, { dictionaryEntries: dictionaryEntriesFromContent(DICTIONARY),
      mentionedPeople: mentionedPeopleFromTasks(tasks), ownerNames: ["Bill Harding"], tasks });
    expect(entries.map(entry => entry.term)).toEqual(["Ship Notes", "Priya", "Dana Whitfield"]);
    expect(entries[2]).toEqual({ aliases: [], definition: "A person the owner links to in 1 recent task such as "
      + "\"Onboarding call prep for @Dana Whitfield\".", isPerson: true, term: "Dana Whitfield" });
  });

  it("reads tasks added since the watermark, oldest first, and is due only after its interval", () => {
    const scannedThrough = NOW.getTime() - 2.5 * 60 * 60 * 1000;
    expect(tasksForTermScan(tasks, { limit: 5, now: NOW, scannedThrough }).tasks.map(scanned => scanned.uuid)).toEqual(["t1"]);
    const firstScan = tasksForTermScan(tasks, { limit: 2, now: NOW, scannedThrough: null });
    expect(firstScan).toMatchObject({ backlog: true, tasks: [{ uuid: "t3" }, { uuid: "t2" }] });
    const recentScan = { backlog: false, lastScanAt: NOW.getTime() - 60 * 1000, people: {}, scannedThrough };
    expect(taskTermScanDue({ now: NOW, scan: recentScan, tasks })).toBe(false);
    const olderScan = { ...recentScan, lastScanAt: NOW.getTime() - SCAN_INTERVAL_MILLISECONDS };
    expect(taskTermScanDue({ now: NOW, scan: olderScan, tasks })).toBe(true);
    expect(taskTermScanDue({ now: NOW, scan: { ...olderScan, scannedThrough: NOW.getTime() }, tasks })).toBe(false);
  });

  it("merges what it finds, records its watermark and links, and queues evidence for the people it added", async () => {
    const app = notebookApp([{ content: DICTIONARY, name: dictionaryNoteName(YEAR), tags: ["plugins/dashboard"] }]);
    const promptRunner = jest.fn(async () => ({ people: [{ aliases: [], definition: "Likely a copywriter on Ship Notes.", name: "Priya" }],
      terms: [] }));
    const handler = createDiscoverTaskTermsHandler({ promptRunner, providerAvailable: async () => true, taskReader: async () => tasks });
    const result = await handler.run({ context: jobContext(app), job: { category: "maintenance", input: { domainUuid: "work-domain", year: YEAR },
      type: handler.type }, signal: null });
    expect(promptRunner.mock.calls[0][1]).toContain("The notebook belongs to Bill Harding.");
    expect(result.addedTerms).toEqual(["Priya", "Dana Whitfield"]);
    expect(result.followUps.map(request => request.input)).toEqual([
      { domainUuid: "work-domain", mentionDigest: null, term: "Priya", year: YEAR },
      { domainUuid: "work-domain", mentionDigest: null, term: "Dana Whitfield", year: YEAR }]);
    expect(app.noteContent(dictionaryNoteName(YEAR))).toContain("- **Priya**: Likely a copywriter on Ship Notes. [builder]");
    const scan = await readTaskTermScan(app, YEAR);
    expect(scan.scannedThrough).toBe(Date.parse(tasks[0].createdAt));
    expect(scan.people["dana whitfield"]).toEqual({ name: "Dana Whitfield", noteUuids: ["note-dana"], personUuids: [] });
  });
});

describe("person evidence and refinement", () => {
  it("leads a person's evidence with their own note and the tasks naming them, and asks who they are to the owner", async () => {
    const app = notebookApp([
      { content: DICTIONARY, name: dictionaryNoteName(YEAR), tags: ["plugins/dashboard"] },
      { content: "Lucian edits our tutorial videos and runs the onboarding A/B tests.", name: "Lucian Ruscanu" },
      { content: "- Storyboard the dashboard tour", name: "Video production" }]);
    const personNoteUuid = (await app.findNote({ name: "Lucian Ruscanu" })).uuid;
    const videoNoteUuid = (await app.findNote({ name: "Video production" })).uuid;
    await app.createNote(`User terms dictionary ${ YEAR } task scan`, ["plugins/dashboard"]);
    const scanUuid = (await app.findNote({ name: `User terms dictionary ${ YEAR } task scan` })).uuid;
    await app.replaceNoteContent({ uuid: scanUuid }, "```json\n" + JSON.stringify({ people: { "lucian ruscanu": { name: "Lucian Ruscanu",
      noteUuids: [personNoteUuid], personUuids: [] } }, schemaVersion: 1 }) + "\n```\n");
    const tasks = [task("t1", "Send Lucian the tour script", 2, videoNoteUuid), task("t2", "Review thumbnails with Lucian", 3, videoNoteUuid)];
    const handler = createCollectTermEvidenceHandler({ taskReader: async () => tasks });
    const result = await handler.run({ context: jobContext(app), job: { category: "maintenance",
      input: { domainUuid: "work-domain", term: "Lucian Ruscanu", year: YEAR }, type: handler.type }, signal: null });
    expect(result.followUps).toHaveLength(1);
    const evidence = (await storedTermEvidence(app, { year: YEAR }))["lucian ruscanu"];
    expect(evidence).toMatchObject({ isPerson: true, ownerNames: ["Bill Harding"] });
    expect(evidence.passages[0].text).toContain("runs the onboarding A/B tests");
    expect(evidence.passages[1].text).toBe("Open tasks naming Lucian Ruscanu in the note \"Video production\" (2 in all):\n"
      + "- Send Lucian the tour script\n- Review thumbnails with Lucian");
    const prompt = termRefinementPrompt({ definition: "Collaborator on video production.", evidence });
    expect(prompt).toContain("Person: Lucian Ruscanu\nThe notebook belongs to Bill Harding.");
    expect(prompt).toContain("who this person most likely is to the owner");
  });

  it("schedules a person's evidence ahead of a term due for the same reason, counting every name", () => {
    const dueTerms = dueTermEvidence({ dictionaryEntries: dictionaryEntriesFromContent(DICTIONARY), evidenceByTermKey: {}, limit: 2,
      now: NOW, tasks: [task("t1", "Amplenote tour with Lucian", 1), task("t2", "Amplenote pricing", 1)] });
    expect(dueTerms.map(dueTerm => [dueTerm.term, dueTerm.isPerson, dueTerm.mentionCount])).toEqual([["Lucian Ruscanu", true, 1],
      ["Amplenote", false, 2]]);
  });
});
