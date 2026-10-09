// Exercise how a project's reasons are split around the task identities discovery cites, so the projects page can
// draw each task in place of its UUID and drop citations of tasks that no longer exist.

import { citedTaskUuidsFromSubstantiations, readableTaskText, substantiationSegments,
  substantiationWithoutTaskReferences, taskChipLabel } from "dashboard/plan-wizard/substantiation-task-references";

const MEMO_UUID = "e010af78-335e-4e4f-979f-23fe909c572c";
const DATA_UUID = "51781bfb-1c64-4f06-a76c-2c9534e85a52";
const REASON = `Resolves Acme deliverables by writing the memo [${ MEMO_UUID }] and requesting data [${ DATA_UUID }].`;

describe("citedTaskUuidsFromSubstantiations", () => {
  it("lists each cited identity once, lowercased, in reading order", () => {
    const reasons = [REASON, `Also [${ MEMO_UUID.toUpperCase() }, ${ DATA_UUID }].`];
    expect(citedTaskUuidsFromSubstantiations(reasons)).toEqual([MEMO_UUID, DATA_UUID]);
  });
});

describe("substantiationWithoutTaskReferences", () => {
  it("removes bracketed citations and repairs the punctuation they leave", () => {
    expect(substantiationWithoutTaskReferences(REASON))
      .toBe("Resolves Acme deliverables by writing the memo and requesting data.");
  });

  it("removes a bracketed list and a bare identity", () => {
    const reason = `Ships the launch (${ MEMO_UUID }, ${ DATA_UUID }), see ${ MEMO_UUID }.`;
    expect(substantiationWithoutTaskReferences(reason)).toBe("Ships the launch, see.");
  });
});

describe("substantiationSegments", () => {
  it("splits a reason into text and the tasks it cites", () => {
    expect(substantiationSegments(REASON)).toEqual([
      { kind: "text", text: "Resolves Acme deliverables by writing the memo " },
      { kind: "task", taskUuid: MEMO_UUID },
      { kind: "text", text: " and requesting data " },
      { kind: "task", taskUuid: DATA_UUID },
      { kind: "text", text: "." },
    ]);
  });

  it("drops the citation of a task that is not kept", () => {
    const segments = substantiationSegments(REASON, taskUuid => taskUuid !== DATA_UUID);
    expect(segments).toEqual([
      { kind: "text", text: "Resolves Acme deliverables by writing the memo " },
      { kind: "task", taskUuid: MEMO_UUID },
      { kind: "text", text: " and requesting data." },
    ]);
  });

  it("draws every identity in a cited list", () => {
    const segments = substantiationSegments(`Both [${ MEMO_UUID }, ${ DATA_UUID }] matter`);
    const taskSegments = segments.filter(segment => segment.kind === "task");
    expect(taskSegments.map(segment => segment.taskUuid)).toEqual([MEMO_UUID, DATA_UUID]);
  });

  it("returns a reason without citations as one text segment", () => {
    expect(substantiationSegments("Named by you.")).toEqual([{ kind: "text", text: "Named by you." }]);
  });
});

describe("task chip text", () => {
  it("keeps the first three words and marks that more follows", () => {
    expect(taskChipLabel("Write the Acme memo, then send it")).toBe("Write the Acme…");
    expect(taskChipLabel("Request data")).toBe("Request data");
  });

  it("reads task markdown as plain words", () => {
    expect(readableTaskText("Review **[Acme spec](https://example.com)** draft <!-- {\"uuid\":\"x\"} -->"))
      .toBe("Review Acme spec draft");
  });
});
