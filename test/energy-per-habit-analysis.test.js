/**
 * [Claude claude-opus-4-8 (1M context)-authored file]
 * Prompt summary: "add focused tests for the energy-per-habit analysis: habit grouping by recurrence,
 *   normalized content, day-done-vs-off mood delta, streaks, and the min-days filter"
 */
import { analyzeHabitMoodDeltas, isHabitTask, moodByDayFromRatings, formatDelta } from "energy-per-habit-analysis";
import { dateKeyFromDateInput } from "util/date-utility";

const DAY = 86400;

// Anchor "today" to local midnight so day-key math is stable regardless of when the test runs.
function midnight(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Unix seconds for `daysBack` days before the reference midnight, at 10am local.
function tsDaysBack(daysBack, ref) {
  return Math.floor((midnight(ref).getTime() - daysBack * DAY * 1000) / 1000) + 10 * 3600;
}

function habitTask(content, daysBack, ref, extra = {}) {
  return { content, repeat: "FREQ=DAILY", completedAt: tsDaysBack(daysBack, ref), victoryValue: 3, ...extra };
}

function mood(rating, daysBack, ref) {
  return { rating, timestamp: tsDaysBack(daysBack, ref) };
}

describe("isHabitTask", () => {
  test("requires a completed task with a non-empty repeat rule", () => {
    expect(isHabitTask({ content: "Jog", completedAt: 100, repeat: "FREQ=DAILY" })).toBe(true);
    expect(isHabitTask({ content: "Jog", completedAt: 100, repeat: null })).toBe(false);
    expect(isHabitTask({ content: "Jog", completedAt: null, repeat: "FREQ=DAILY" })).toBe(false);
    expect(isHabitTask({ content: "Jog", completedAt: 100, repeat: "  " })).toBe(false);
    expect(isHabitTask(null)).toBe(false);
  });
});

describe("moodByDayFromRatings", () => {
  test("averages multiple ratings on the same day", () => {
    const ref = new Date();
    const byDay = moodByDayFromRatings([mood(2, 1, ref), mood(0, 1, ref), mood(-1, 3, ref)]);
    const day1 = dateKeyFromDateInput(new Date(midnight(ref).getTime() - 1 * DAY * 1000));
    const day3 = dateKeyFromDateInput(new Date(midnight(ref).getTime() - 3 * DAY * 1000));
    expect(byDay[day1]).toBeCloseTo(1); // (2 + 0) / 2
    expect(byDay[day3]).toBeCloseTo(-1);
  });
});

describe("analyzeHabitMoodDeltas", () => {
  const ref = new Date();

  test("groups tasks by normalized content across emoji/case/punctuation", () => {
    const tasks = [
      habitTask("🏃 Jog", 2, ref), habitTask("Jog", 4, ref), habitTask("jog!", 6, ref),
    ];
    const moods = [mood(1, 2, ref), mood(1, 4, ref), mood(1, 6, ref), mood(-1, 8, ref)];
    const { habits } = analyzeHabitMoodDeltas({ completedTasks: tasks, moodRatings: moods, today: ref, minDays: 3 });
    expect(habits).toHaveLength(1);
    expect(habits[0].daysDone).toBe(3);
    expect(habits[0].key).toBe("jog");                 // normalized grouping key drops emoji/case/punct
    expect(habits[0].label).toBe("Jog");               // display label strips leading emoji (widget adds its own icon)
  });

  test("computes delta as avg mood on done days minus avg on off days with a mood", () => {
    // Habit done on days 1,2,3 (mood +2 each); off days 5,6,7 have mood -2 each.
    const tasks = [habitTask("Meditate", 1, ref), habitTask("Meditate", 2, ref), habitTask("Meditate", 3, ref)];
    const moods = [
      mood(2, 1, ref), mood(2, 2, ref), mood(2, 3, ref),
      mood(-2, 5, ref), mood(-2, 6, ref), mood(-2, 7, ref),
    ];
    const { habits } = analyzeHabitMoodDeltas({ completedTasks: tasks, moodRatings: moods, today: ref, minDays: 3 });
    expect(habits).toHaveLength(1);
    expect(habits[0].avgMoodOnDone).toBeCloseTo(2);
    expect(habits[0].avgMoodOnOff).toBeCloseTo(-2);
    expect(habits[0].delta).toBeCloseTo(4);
  });

  test("excludes habits done on fewer than minDays distinct days", () => {
    const tasks = [habitTask("Rare thing", 1, ref), habitTask("Rare thing", 2, ref)];
    const moods = [mood(1, 1, ref), mood(1, 2, ref), mood(0, 4, ref), mood(0, 5, ref)];
    const { habits } = analyzeHabitMoodDeltas({ completedTasks: tasks, moodRatings: moods, today: ref, minDays: 3 });
    expect(habits).toHaveLength(0);
  });

  test("ignores non-recurring completed tasks", () => {
    const tasks = [
      { content: "One-off", completedAt: tsDaysBack(1, ref), repeat: null },
      { content: "One-off", completedAt: tsDaysBack(2, ref), repeat: null },
      { content: "One-off", completedAt: tsDaysBack(3, ref), repeat: null },
    ];
    const moods = [mood(1, 1, ref), mood(1, 2, ref), mood(1, 3, ref), mood(0, 5, ref)];
    const { habits, totalHabitTasks } = analyzeHabitMoodDeltas({ completedTasks: tasks, moodRatings: moods, today: ref, minDays: 3 });
    expect(totalHabitTasks).toBe(0);
    expect(habits).toHaveLength(0);
  });

  test("sorts habits by delta descending", () => {
    const tasks = [];
    for (let d = 1; d <= 3; d++) { tasks.push(habitTask("Good habit", d, ref)); tasks.push(habitTask("Bad habit", d + 10, ref)); }
    const moods = [];
    for (let d = 1; d <= 3; d++) moods.push(mood(2, d, ref));        // good-habit days: high mood
    for (let d = 11; d <= 13; d++) moods.push(mood(-2, d, ref));     // bad-habit days: low mood
    const { habits } = analyzeHabitMoodDeltas({ completedTasks: tasks, moodRatings: moods, today: ref, minDays: 3 });
    expect(habits.map(h => h.label)).toEqual(["Good habit", "Bad habit"]);
    expect(habits[0].delta).toBeGreaterThan(habits[1].delta);
  });

  test("computes the trailing streak ending today", () => {
    // Done on the 3 most recent days (0,1,2) => streak 3; also done day 5 (broken by gaps 3,4).
    const tasks = [habitTask("Streaky", 0, ref), habitTask("Streaky", 1, ref), habitTask("Streaky", 2, ref), habitTask("Streaky", 5, ref)];
    const moods = [mood(1, 0, ref), mood(1, 1, ref), mood(1, 2, ref), mood(0, 4, ref), mood(0, 6, ref)];
    const { habits } = analyzeHabitMoodDeltas({ completedTasks: tasks, moodRatings: moods, today: ref, minDays: 3 });
    expect(habits[0].streak).toBe(3);
  });
});

describe("formatDelta", () => {
  test("formats signed two-decimal deltas", () => {
    expect(formatDelta(0.35)).toBe("+0.35");
    expect(formatDelta(-0.19)).toBe("−0.19");
    expect(formatDelta(0)).toBe("0.00");
  });
});
