/**
 * [Claude claude-opus-4-8 (1M context)-authored file]
 * Prompt summary: "add focused tests for the energy-per-habit analysis: content grouping (no RRULE required),
 *   completion-count + mood-day eligibility, day-done-vs-off delta, streaks, month keys, per-month aggregates,
 *   and cache-backed monthly aggregation"
 */
import {
  aggregateMonthlyHabits, analyzeHabitMoodDeltas, computeMonthlyAggregates, formatDelta, isHabitTask,
  monthKeyFromMonthLabel, monthLabelFromMonthKey, moodByDayFromRatings, trailingMonthKeys,
} from "energy-per-habit-analysis";
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

// Completed task on `daysBack`. No repeat rule by default — grouping is by content now, not RRULE.
function task(content, daysBack, ref, extra = {}) {
  return { content, completedAt: tsDaysBack(daysBack, ref), victoryValue: 3, ...extra };
}

function mood(rating, daysBack, ref) {
  return { rating, timestamp: tsDaysBack(daysBack, ref) };
}

// Build N completed occurrences of a habit on the N most recent days (each with a matching mood).
function occurrences(content, days, ref) {
  return days.map(d => task(content, d, ref));
}

describe("isHabitTask", () => {
  test("requires a completed task with a non-empty repeat rule (retained helper)", () => {
    expect(isHabitTask({ content: "Jog", completedAt: 100, repeat: "FREQ=DAILY" })).toBe(true);
    expect(isHabitTask({ content: "Jog", completedAt: 100, repeat: null })).toBe(false);
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

describe("month key helpers", () => {
  test("round-trips YYYY-MM <-> 'Month Year'", () => {
    expect(monthLabelFromMonthKey("2026-05")).toBe("May 2026");
    expect(monthLabelFromMonthKey("2025-06")).toBe("June 2025");
    expect(monthKeyFromMonthLabel("May 2026")).toBe("2026-05");
    expect(monthKeyFromMonthLabel("June 2025")).toBe("2025-06");
    expect(monthKeyFromMonthLabel("not a month")).toBeNull();
  });

  test("trailingMonthKeys returns oldest-first N months ending at today's month", () => {
    const keys = trailingMonthKeys(new Date(2026, 6, 18), 12); // July 2026
    expect(keys).toHaveLength(12);
    expect(keys[keys.length - 1]).toBe("2026-07");
    expect(keys[0]).toBe("2025-08");
  });
});

describe("analyzeHabitMoodDeltas", () => {
  const ref = new Date();

  test("groups tasks by normalized content across emoji/case/punctuation (no RRULE required)", () => {
    const tasks = [
      ...occurrences("🏃 Jog", [2, 4, 6, 8, 10], ref),
      ...occurrences("Jog", [12, 14], ref),
      ...occurrences("jog!", [16, 18], ref),
    ];
    const moods = [];
    for (const d of [2, 4, 6, 8, 10, 12, 14, 16, 18]) moods.push(mood(1, d, ref));
    for (const d of [3, 5, 7]) moods.push(mood(-1, d, ref)); // off days
    const { habits } = analyzeHabitMoodDeltas({ completedTasks: tasks, moodRatings: moods, today: ref });
    expect(habits).toHaveLength(1);
    expect(habits[0].key).toBe("jog");     // normalized grouping key drops emoji/case/punct
    expect(habits[0].label).toBe("Jog");   // display label strips leading emoji (widget adds its own icon)
    expect(habits[0].completions).toBe(9);
  });

  test("requires at least 5 completions to be eligible", () => {
    const tasks = occurrences("Meditate", [1, 2, 3, 4], ref); // only 4 completions
    const moods = [mood(2, 1, ref), mood(2, 2, ref), mood(2, 3, ref), mood(2, 4, ref), mood(-2, 6, ref)];
    const { habits } = analyzeHabitMoodDeltas({ completedTasks: tasks, moodRatings: moods, today: ref });
    expect(habits).toHaveLength(0);
  });

  test("requires mood ratings on at least 3 done days", () => {
    // 5 completions but mood recorded on only 2 of the done days.
    const tasks = occurrences("Read", [1, 2, 3, 4, 5], ref);
    const moods = [mood(2, 1, ref), mood(2, 2, ref), mood(-2, 8, ref), mood(-2, 9, ref)];
    const { habits } = analyzeHabitMoodDeltas({ completedTasks: tasks, moodRatings: moods, today: ref });
    expect(habits).toHaveLength(0);
  });

  test("computes delta as avg mood on done days minus avg on off days with a mood", () => {
    const tasks = occurrences("Meditate", [1, 2, 3, 4, 5], ref); // 5 done days, mood +2 each
    const moods = [
      mood(2, 1, ref), mood(2, 2, ref), mood(2, 3, ref), mood(2, 4, ref), mood(2, 5, ref),
      mood(-2, 7, ref), mood(-2, 8, ref), mood(-2, 9, ref),
    ];
    const { habits } = analyzeHabitMoodDeltas({ completedTasks: tasks, moodRatings: moods, today: ref });
    expect(habits).toHaveLength(1);
    expect(habits[0].avgMoodOnDone).toBeCloseTo(2);
    expect(habits[0].avgMoodOnOff).toBeCloseTo(-2);
    expect(habits[0].delta).toBeCloseTo(4);
  });

  test("computes the trailing streak ending today", () => {
    // Done on the 3 most recent days (0,1,2) => streak 3; plus days 5,6 to clear the 5-completion gate.
    const tasks = occurrences("Streaky", [0, 1, 2, 5, 6], ref);
    const moods = [mood(1, 0, ref), mood(1, 1, ref), mood(1, 2, ref), mood(1, 5, ref), mood(1, 6, ref), mood(0, 4, ref), mood(0, 8, ref)];
    const { habits } = analyzeHabitMoodDeltas({ completedTasks: tasks, moodRatings: moods, today: ref });
    expect(habits[0].streak).toBe(3);
  });
});

describe("computeMonthlyAggregates + aggregateMonthlyHabits", () => {
  test("stores per-month rows only for tasks completed more than once, and aggregates them", () => {
    const ref = new Date(2026, 6, 18); // Jul 18 2026
    const monthKeys = ["2026-06", "2026-07"];
    // "Walk": done twice in June, thrice in July. "Onceoff": done once each month (should be dropped).
    const tasks = [
      task("Walk", 40, ref), task("Walk", 41, ref),                 // June (≈ Jun 8, Jun 7)
      task("Walk", 1, ref), task("Walk", 2, ref), task("Walk", 3, ref), // July
      task("Onceoff", 42, ref), task("Onceoff", 4, ref),
    ];
    const moods = [
      mood(2, 40, ref), mood(2, 41, ref), mood(2, 1, ref), mood(2, 2, ref), mood(2, 3, ref),
      mood(-2, 5, ref), mood(-2, 6, ref), mood(-2, 43, ref),
    ];
    const months = computeMonthlyAggregates({ completedTasks: tasks, moodRatings: moods, monthKeys });
    const june = months.get("2026-06");
    const july = months.get("2026-07");
    expect(june.rows.map(r => r.label)).toEqual(["Walk"]);   // Onceoff dropped (only 1/month)
    expect(july.rows.find(r => r.label === "Walk").count).toBe(3);

    const habits = aggregateMonthlyHabits(months, { minCompletions: 5, minMoodDays: 3 });
    expect(habits).toHaveLength(1);
    expect(habits[0].label).toBe("Walk");
    expect(habits[0].completions).toBe(5);                   // 2 (June) + 3 (July)
    expect(habits[0].avgMoodOnDone).toBeCloseTo(2);
    expect(habits[0].delta).toBeGreaterThan(0);
  });
});

describe("formatDelta", () => {
  test("formats signed two-decimal deltas", () => {
    expect(formatDelta(0.35)).toBe("+0.35");
    expect(formatDelta(-0.19)).toBe("−0.19");
    expect(formatDelta(0)).toBe("0.00");
  });
});
