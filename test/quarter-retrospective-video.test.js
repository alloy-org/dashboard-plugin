// Quarter Retrospective video: the story's slides are laid along the video's clock as long as each holds in the story,
// and the slides that wait on the user are left out.
const { SHORT_SLIDE_DURATION_FACTOR, SLIDE_KINDS } = await import("dashboard/quarter-retrospective/retrospective-slides");
const { videoTimeline } = await import("dashboard/quarter-retrospective/retrospective-video");

const SLIDE_MILLISECONDS = 6000;
const LONG_CAPTION = "One two three four five six seven eight nine ten eleven twelve.";

describe("retrospective video timeline", () => {
  it("holds each slide as long as the story does, back to back, without its interactive slides", () => {
    const slides = [{ caption: LONG_CAPTION, headline: "Intro", id: "intro", kind: SLIDE_KINDS.figure },
      { caption: "", headline: "Rank", id: "payoff-ranking", kind: SLIDE_KINDS.payoffRanking },
      { headline: "Short", id: "short", kind: SLIDE_KINDS.figure },
      { durationFactor: 1.5, headline: "Heap", id: "progress-heap", kind: SLIDE_KINDS.heap },
      { headline: "What next?", id: "end-card", kind: SLIDE_KINDS.endCard }];
    const timeline = videoTimeline(slides, SLIDE_MILLISECONDS);
    const shownIds = timeline.map(entry => entry.slide.id);
    expect(shownIds).toEqual(["intro", "short", "progress-heap"]);
    expect(timeline[0]).toMatchObject({ durationSeconds: 6, startSeconds: 0 });
    expect(timeline[1].durationSeconds).toBeCloseTo(6 * SHORT_SLIDE_DURATION_FACTOR);
    expect(timeline[2].startSeconds).toBeCloseTo(6 + 6 * SHORT_SLIDE_DURATION_FACTOR);
    expect(timeline[2].durationSeconds).toBeCloseTo(9);
  });
});
