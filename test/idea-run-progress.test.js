// Exercise the "Generate ideas" progress window's host side: the words it shows for a snapshot, the relay that carries
// snapshots from the Dashboard to the window, and the page an Amplenote prompt renders for a run.
import { etaLabel, ideaRunProgressView, ideaRunSummaryLines } from "dashboard/idea-run-progress-view";
import { buildIdeaRunProgressHTML, ideaRunProgressRunId } from "idea-run-progress-embed";
import { readIdeaRunProgress, updateIdeaRunProgress } from "idea-run-progress-relay";

const SNAPSHOT = { allowance: { maximum: 2, runNumber: 1 }, etaSeconds: 200, finished: false, projectCount: 2, quotaUsedFraction: 0.384,
  runId: "run-abc", startedAt: 0, steps: [{ key: "refine", label: "Refine definitions", state: "done" },
    { key: "ideas", label: "Generate ideas", state: "active" }], summary: null, title: "Generating ideas for 2 Projects" };

describe("idea run progress", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The status line names the run of the day and the quota consumed, and the meter hides without quota data.
  it("describes a snapshot for the window", () => {
    const view = ideaRunProgressView(SNAPSHOT);
    expect(view.statusParts).toEqual(["Run 1 of 2 max per day", "Consumed 38% of Agent Pro quota"]);
    expect(view.steps.map(step => [step.number, step.state])).toEqual([[1, "done"], [2, "active"]]);
    expect(view.etaLabel).toBe("About 4 min left");
    expect(ideaRunProgressView({ ...SNAPSHOT, quotaUsedFraction: null }).quotaPercent).toBeNull();
    expect(ideaRunProgressView(null).found).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The time left reads in minutes, then under a minute, then holds at finishing up past the estimate.
  it("labels the time left", () => {
    expect(etaLabel({ etaSeconds: 61, finished: false })).toBe("About 2 min left");
    expect(etaLabel({ etaSeconds: 30, finished: false })).toBe("Less than a minute left");
    expect(etaLabel({ etaSeconds: 0, finished: false })).toBe("Finishing up…");
    expect(etaLabel({ etaSeconds: null, finished: true })).toBe("Done");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The summary says what each project gained, how many definitions were refined, and what failed.
  it("writes the summary as sentences", () => {
    const lines = ideaRunSummaryLines({ failures: [{ detail: "Provider down", jobType: "rateProjectIdeas", subject: "Hiring" }],
      projects: [{ ideasDetail: "Generated 5 ideas, kept 3", name: "Launch", recommendableAfter: 4, recommendableBefore: 1, relatedTasksAfter: 6,
        relatedTasksBefore: 4, targeted: true }], refinedTermCount: 2 });
    expect(lines).toEqual(['"Launch": Generated 5 ideas, kept 3; 4 recommendable ideas (was 1); 2 more related tasks.',
      "Refined 2 dictionary definitions.", 'Could not finish "Hiring": Provider down']);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A snapshot pushed by the Dashboard is read back by the window as its view; an unknown run reads as not found.
  it("relays snapshots by run", () => {
    expect(updateIdeaRunProgress({ title: "No run" })).toBe(false);
    updateIdeaRunProgress(SNAPSHOT);
    expect(readIdeaRunProgress("run-abc").title).toBe("Generating ideas for 2 Projects");
    expect(readIdeaRunProgress("run-unknown").found).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The prompt's embed arguments name the run, as an object or as JSON, and the page carries only a safe run ID.
  it("renders a progress page for a prompt naming a run", () => {
    expect(ideaRunProgressRunId([{ runId: "run-abc", view: "ideaRunProgress" }])).toBe("run-abc");
    expect(ideaRunProgressRunId([JSON.stringify({ runId: "run-json", view: "ideaRunProgress" })])).toBe("run-json");
    expect(ideaRunProgressRunId([])).toBeNull();
    const html = buildIdeaRunProgressHTML({ hostTheme: { lightDarkMode: "dark", styleProperties: ":root{}" }, runId: 'run-"><script>' });
    expect(html).toContain('data-run-id="run-script"');
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain("ideaRunProgressRead");
  });
});
