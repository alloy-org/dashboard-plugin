// The calendar tooltip names the project a suggestion serves and answers why finishing the task leaves the user
// better off, in one sentence or two.
import { jest } from "@jest/globals";
import { activitiesWithBenefitRationales, agendaWithBenefitRationales, benefitRationalePrompt,
  calendarSuggestionExplanation } from "calendar-suggestion-explanation";

const WALK = { projectSummary: "Make one new friend",
  title: "Choose a nearby 45-minute walking route and text one acquaintance" };

describe("calendar suggestion explanations", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The tooltip leads with the project, then the benefit, and leaves the ranker's evidence out.
  it("names the project and prefers the benefit over the ranking rationale", () => {
    const explanation = calendarSuggestionExplanation({ ...WALK,
      benefit: "This task serves the dual purpose of social engagement and physical fitness.",
      reason: "The user picked this as a 'Keep warm' emphasis." });
    expect(explanation).toBe("Project: Make one new friend\n"
      + "This task serves the dual purpose of social engagement and physical fitness.");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A suggestion on a weekday the user chose for its project says so after the benefit.
  it("mentions the project's daily emphasis after the benefit", () => {
    const explanation = calendarSuggestionExplanation({ ...WALK, benefit: "You will have a walking partner lined up.",
      emphasizedWeekday: "Tuesday" });
    expect(explanation).toBe("Project: Make one new friend\n"
      + "You will have a walking partner lined up. You chose Tuesday as a day of emphasis for this project.");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A fallback reason that already names the day is not followed by a second mention of it.
  it("does not repeat a daily emphasis the rationale already names", () => {
    const reason = "This project is scheduled for Tuesdays and today is Tuesday.";
    const explanation = calendarSuggestionExplanation({ ...WALK, emphasizedWeekday: "Tuesday", reason });
    expect(explanation).toBe(`Project: Make one new friend\n${ reason }`);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A suggestion that is not tied to a project keeps its rationale as the whole tooltip.
  it("omits the project line when no project is known", () => {
    expect(calendarSuggestionExplanation({ reason: "Keeps the afternoon anchored to a concrete deliverable." }))
      .toBe("Keeps the afternoon anchored to a concrete deliverable.");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The prompt asks the benefit question once per task and keeps the tasks in order.
  it("asks why the user is better off, in one or two sentences", () => {
    const prompt = benefitRationalePrompt([WALK, { taskText: "Ship the picker", projectSummary: "Launch dashboard" }]);
    expect(prompt).toContain("Why am I better off after completing this task?");
    expect(prompt).toContain("one sentence, or two at most");
    expect(prompt).toContain("1. Project: Make one new friend. Task: Choose a nearby 45-minute walking route");
    expect(prompt).toContain("2. Project: Launch dashboard. Task: Ship the picker");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A ranked day asks for every suggestion. A day the model already explained does not ask again, except
  //   for a project the model left out.
  it("asks only for suggestions that still need a benefit sentence", async () => {
    const promptRunner = jest.fn(async () => ({ benefits: [
      "This task serves the dual purpose of social engagement and physical fitness. A second sentence stays. A third is dropped.",
      "Writing the notes makes the launch reviewable." ] }));
    const ranked = await agendaWithBenefitRationales({}, { activities: [WALK], fromRanking: true,
      reserveTasks: [{ taskText: "Write the notes" }] }, { promptRunner });
    expect(promptRunner).toHaveBeenCalledTimes(1);
    expect(ranked.activities[0].benefit).toBe("This task serves the dual purpose of social engagement and physical fitness. "
      + "A second sentence stays.");
    expect(ranked.reserveTasks[0].benefit).toBe("Writing the notes makes the launch reviewable.");

    promptRunner.mockClear();
    const explained = await agendaWithBenefitRationales({}, { activities: [{ reason: "Already a benefit.", title: "Ship" }],
      fromRanking: false, reserveTasks: [] }, { promptRunner });
    expect(promptRunner).not.toHaveBeenCalled();
    expect(explained.activities[0].benefit).toBeUndefined();

    const omitted = { needsBenefitRationale: true, reason: "You chose 2 blocks per week.", title: "Build the picker" };
    promptRunner.mockResolvedValue({ benefits: ["Building the picker gets the launch onto the calendar."] });
    const filled = await activitiesWithBenefitRationales({}, [omitted], { include: item => item.needsBenefitRationale,
      promptRunner });
    expect(filled[0].benefit).toBe("Building the picker gets the launch onto the calendar.");
    expect(filled[0].reason).toBe("You chose 2 blocks per week.");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A provider that fails leaves the suggestions in place, still explainable from their existing reason.
  it("keeps the suggestions when the benefit request fails", async () => {
    const promptRunner = jest.fn(async () => { throw new Error("provider down"); });
    const activities = await activitiesWithBenefitRationales({}, [WALK], { promptRunner });
    expect(activities).toEqual([WALK]);
    const explanation = calendarSuggestionExplanation({ ...activities[0], reason: "Keep warm." });
    expect(explanation).toBe("Project: Make one new friend\nKeep warm.");
  });
});
