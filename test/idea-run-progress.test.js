// Exercise the "Generate ideas" progress window's host side: the words it shows for a snapshot, the relay that carries
// snapshots from the Dashboard to the window, and the page an Amplenote prompt renders for a run.
import { etaLabel, ideaRunProgressLines, ideaRunProgressView, ideaRunSummaryLines, lineText } from "dashboard/idea-generation/idea-run-progress-view";
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
    expect(view.statusParts).toEqual(["Run 1 of 2 max per day", "Consumed 38% of AI quota"]);
    expect(view.steps.map(step => [step.number, step.state])).toEqual([[1, "done"], [2, "active"]]);
    expect(view.etaLabel).toBe("About 4 min left");
    expect(ideaRunProgressView({ ...SNAPSHOT, quotaUsedFraction: null }).quotaPercent).toBeNull();
    expect(ideaRunProgressView(null).found).toBe(false);
    expect(view.heading).toBe("Generate ideas");
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
  // @desc While refining, discovery says it is looking; later each subject the run reached gets a sentence with a
  //   count and quoted examples, and the eligible suggestions appear once rating starts.
  it("writes progress messages as the run reaches each subject", () => {
    const refiningSteps = [{ key: "refine", state: "active" }, { key: "ideas", state: "waiting" }, { key: "rate", state: "waiting" },
      { key: "summarize", state: "waiting" }];
    const progress = { foundTerms: null, ideaProjects: { count: 4, examples: ["Launch", "Hiring", "Docs"] },
      refiningTerms: { count: 2, examples: ["Roadmap", "Jots"], refinedCount: 0 }, storeCounts: { eligibleIdeaCount: 0,
        eligibleTaskCount: 5, newEligibleIdeaCount: 0, newIdeaCount: 0, newRatedIdeaCount: 0 } };
    expect(ideaRunProgressLines(progress, refiningSteps)).toEqual(["Looking through your projects for new terms to define…",
      'Better defining 2 terms, such as "Roadmap" and "Jots".', 'Generating ideas for 4 projects: "Launch", "Hiring", "Docs" and 1 more.']);

    const ratingSteps = [{ key: "refine", state: "done" }, { key: "ideas", state: "done" }, { key: "rate", state: "active" },
      { key: "summarize", state: "waiting" }];
    const ratedProgress = { ...progress, foundTerms: { count: 1, examples: ["GTD"] }, refiningTerms: { ...progress.refiningTerms, refinedCount: 1 },
      storeCounts: { eligibleIdeaCount: 7, eligibleTaskCount: 5, newEligibleIdeaCount: 6, newIdeaCount: 10, newRatedIdeaCount: 8 } };
    expect(ideaRunProgressLines(ratedProgress, ratingSteps)).toEqual(['Defining 1 new term, such as "GTD".',
      'Better defining 2 terms, such as "Roadmap" and "Jots"; 1 refined so far.', 'Generating ideas for 4 projects: "Launch", "Hiring", "Docs" and 1 more.',
      "6 of 8 rated new ideas met the bar (actionability 7+, relevance 6+); 2 still awaiting a rating.",
      "12 suggestions eligible to recommend: 5 of your tasks and 7 generated ideas."]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Once discovery settles, its sentence counts the terms the dictionary already defined, linked to its note.
  it("links the discovery sentence to the terms dictionary", () => {
    const steps = [{ key: "refine", state: "active" }];
    const progress = { dictionary: { noteUuid: "dictionary-uuid", termCount: 12 }, foundTerms: { count: 0, examples: [] },
      ideaProjects: { count: 0, examples: [] }, refiningTerms: { count: 0, examples: [] }, storeCounts: null };
    const [discoveryLine] = ideaRunProgressLines(progress, steps);
    expect(lineText(discoveryLine)).toBe("Found no new terms to define (12 already defined).");
    expect(discoveryLine[1]).toEqual({ noteUuid: "dictionary-uuid", text: "12 already defined" });
    expect(ideaRunProgressLines({ ...progress, dictionary: null }, steps)[0]).toBe("Found no new terms to define.");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A refine step that ends before discovery reports still names the dictionary's count.
  it("keeps the dictionary count when discovery has not reported by the end of refining", () => {
    const steps = [{ key: "refine", state: "timedOut" }, { key: "ideas", state: "active" }];
    const progress = { dictionary: { noteUuid: "dictionary-uuid", termCount: 12 }, foundTerms: null,
      ideaProjects: { count: 0, examples: [] }, refiningTerms: { count: 0, examples: [] }, storeCounts: null };
    const [discoveryLine] = ideaRunProgressLines(progress, steps);
    expect(lineText(discoveryLine)).toBe("New terms to define are still being looked for (12 already defined).");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The summary says what each project gained, its name in bold, how many definitions were refined, and what failed.
  it("writes the summary as sentences", () => {
    const lines = ideaRunSummaryLines({ failures: [{ detail: "Provider down", jobType: "rateProjectIdeas", subject: "Hiring" }],
      projects: [{ ideasDetail: "Generated 5 ideas, kept 3", name: "Launch", recommendableAfter: 4, recommendableBefore: 1, suggestableTasksAfter: 6,
        suggestableTasksBefore: 4, targeted: true }], refinedTermCount: 2 });
    expect(lines.map(line => lineText(line))).toEqual(["Launch: Generated 5 ideas, kept 3; 4 recommendable ideas (was 1); 6 of your tasks (was 4).",
      "Refined 2 dictionary definitions.", 'Could not finish "Hiring": Provider down']);
    expect(lines[0][0]).toEqual({ strong: true, text: "Launch" });
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
